"""Imports Modes from a PRS-format Emitter XML file — the mirror of
app.services.xml_export.xml_exporter_service::_generate_emitter_xml. Only
Modes (and the EW Groups/Scan data they reference) are imported; Sources are
this app's own provenance concept and don't exist in the PRS format, so the
caller always supplies which Source the imported Modes attach to.

Lossy by construction, in ways worth knowing up front:
- The export only ever writes engineered (raw ± delta) Frequency/PulseWidth/
  PRI values, never the original raw value and delta separately — so a
  re-imported Mode's raw value IS the engineered value, with delta forced to
  0. This is the only choice that doesn't fabricate a delta that was never
  recorded, but it does mean re-importing loses whatever tolerance margin
  the original Mode had.
- _sanitize() replaces spaces with underscores in every Name attribute on
  export (Mode name, EW Group/Scan name) — that substitution isn't reversed
  on import, so a re-imported Mode/EW Group name may have underscores where
  the original had spaces.
- Xlet Modes carry no usable parameter fields yet (see ModeEditForm's own
  "Xlet: no fields defined yet" note) — an Xlet Mode imports with an empty
  line beyond RF/PW, same as one created by hand today.
"""

import uuid
from dataclasses import dataclass, field

from lxml import etree
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.enums import PriType
from app.dsl.exceptions import DslSyntaxError
from app.dsl.renderer import render_mode_line
from app.models.ew_group import EwGroup
from app.models.mode import Mode, ModeLine
from app.schemas.mode import ModeLineFields, require_manual_deltas, validate_pri_type_fields

# Kept in sync with the same set in app/routers/modes.py and
# app/services/mode_batch_service.py — see those modules' own comments.
_NON_DSL_LINE_FIELDS = {
    "type_data",
    "rf_delta",
    "pw_delta",
    "pri_delta",
    "frame_time_delta_us",
    "rf_range_matching",
    "pw_range_matching",
    "pri_range_matching",
}


class PrsXmlParseError(ValueError):
    """The file isn't a well-formed PRS Emitter XML at all (unparseable XML,
    or missing the root <Emitter> element) — distinct from a per-Mode issue,
    which is collected instead of raised so one bad Mode doesn't block the
    rest of a large file from even being previewed."""


@dataclass
class ParsedEwGroup:
    name: str
    scan_min: float | None = None
    scan_max: float | None = None
    threat_priority: int | None = None
    ageout: float | None = None


@dataclass
class ParsedModeLine:
    rf_min_mhz: float
    rf_max_mhz: float
    pw_min_us: float
    pw_max_us: float
    rf_range_matching: bool
    pw_range_matching: bool
    pri_range_matching: bool
    pri_min_us: float | None = None
    pri_max_us: float | None = None
    jitter_min_us: float | None = None
    jitter_max_us: float | None = None
    pri_stagger_values_us: list[float] | None = None


@dataclass
class ParsedMode:
    name: str
    ew_group_name: str
    pri_type: PriType
    line: ParsedModeLine


@dataclass
class ParsedPrsEmitter:
    emitter_name: str
    ew_groups: list[ParsedEwGroup] = field(default_factory=list)
    modes: list[ParsedMode] = field(default_factory=list)


_CLASS_TO_PRI_TYPE = {
    "Simple": PriType.fixed,
    "Stagger": PriType.stagger,
    "Xlet": PriType.xlet,
    "CW": PriType.cw,
}


def _float(el, attr: str) -> float | None:
    if el is None:
        return None
    raw = el.get(attr)
    if raw is None:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _int(el, attr: str) -> int | None:
    v = _float(el, attr)
    return int(v) if v is not None else None


def _bool(el, attr: str) -> bool:
    return el is not None and (el.get(attr) or "").strip().lower() == "true"


def parse_emitter_xml(xml_bytes: bytes) -> ParsedPrsEmitter:
    try:
        root = etree.fromstring(xml_bytes)
    except etree.XMLSyntaxError as exc:
        raise PrsXmlParseError(f"Not a valid XML file: {exc}") from exc

    if root.tag != "Emitter":
        raise PrsXmlParseError(f"Expected an <Emitter> root element, found <{root.tag}>")

    emitter_name = root.get("Name") or "Imported Emitter"

    # EWParameters SetId -> (threat_priority, ageout), so a Scan referencing
    # one via EWParametersRef can pull its values in.
    ew_params_by_set_id: dict[str, tuple[int | None, float | None]] = {}
    for ew_params_el in root.findall("EWParameters"):
        set_id = ew_params_el.get("SetId")
        if set_id is None:
            continue
        threat_priority = _int(ew_params_el.find("ThreatPriority"), "Value")
        ageout = _float(ew_params_el.find("Ageout"), "Value")
        ew_params_by_set_id[set_id] = (threat_priority, ageout)

    ew_groups: list[ParsedEwGroup] = []
    seen_group_names: set[str] = set()
    for scan_el in root.findall("Scan"):
        name = scan_el.get("Name")
        if not name or name in seen_group_names:
            continue
        seen_group_names.add(name)
        period_el = scan_el.find("Period")
        ref_el = scan_el.find("EWParametersRef")
        set_id = ref_el.get("SetId") if ref_el is not None else None
        threat_priority, ageout = ew_params_by_set_id.get(set_id, (None, None))
        ew_groups.append(
            ParsedEwGroup(
                name=name,
                scan_min=_float(period_el, "Min"),
                scan_max=_float(period_el, "Max"),
                threat_priority=threat_priority,
                ageout=ageout,
            )
        )

    modes: list[ParsedMode] = []
    for mode_el in root.findall("Mode"):
        name = mode_el.get("Name") or ""
        # "" (never a valid Name attribute) marks a Mode with no ScanData
        # link at all — nothing to group it under. Left for
        # build_import_plan to report as a per-Mode issue rather than
        # raised here, so one malformed Mode doesn't sink a whole file of
        # otherwise-good ones.
        scan_data_el = mode_el.find("ScanData")
        ew_group_name = (scan_data_el.get("Name") if scan_data_el is not None else None) or ""
        if ew_group_name and ew_group_name not in seen_group_names:
            seen_group_names.add(ew_group_name)
            ew_groups.append(ParsedEwGroup(name=ew_group_name))

        range_match_el = mode_el.find("RangeMatch")
        freq_el = mode_el.find("Frequency")
        pw_el = mode_el.find("PulseWidth")
        pri_el = mode_el.find("PRI")
        pri_class = pri_el.get("Class") if pri_el is not None else None
        pri_type = _CLASS_TO_PRI_TYPE.get(pri_class or "", None)

        pri_min = pri_max = jitter_min = jitter_max = None
        stagger_values: list[float] | None = None
        if pri_el is not None and pri_type == PriType.fixed:
            simple_el = pri_el.find("SimplePRI")
            jitter_el = pri_el.find("Jitter")
            pri_min, pri_max = _float(simple_el, "Min"), _float(simple_el, "Max")
            jitter_min = _float(jitter_el, "Min") or 0.0
            jitter_max = _float(jitter_el, "Max") or 0.0
        elif pri_el is not None and pri_type == PriType.stagger:
            levels_el = pri_el.find("StaggerLevels")
            if levels_el is not None:
                stagger_values = [
                    v for lvl in levels_el.findall("Level") if (v := _float(lvl, "Value")) is not None
                ]

        line = ParsedModeLine(
            rf_min_mhz=_float(freq_el, "Min") or 0.0,
            rf_max_mhz=_float(freq_el, "Max") or 0.0,
            pw_min_us=_float(pw_el, "Min") or 0.0,
            pw_max_us=_float(pw_el, "Max") or 0.0,
            rf_range_matching=_bool(range_match_el, "Frequency"),
            pw_range_matching=_bool(range_match_el, "PulseWidth"),
            pri_range_matching=_bool(range_match_el, "PRI"),
            pri_min_us=pri_min,
            pri_max_us=pri_max,
            jitter_min_us=jitter_min,
            jitter_max_us=jitter_max,
            pri_stagger_values_us=stagger_values,
        )
        modes.append(
            ParsedMode(
                name=name,
                ew_group_name=ew_group_name,
                pri_type=pri_type or PriType.cw,
                line=line,
            )
        )

    return ParsedPrsEmitter(emitter_name=emitter_name, ew_groups=ew_groups, modes=modes)


@dataclass
class PrsImportIssue:
    mode_name: str
    error: str


@dataclass
class PlannedPrsMode:
    parsed: ParsedMode
    line_fields: ModeLineFields


def _build_line_fields(m: ParsedMode) -> ModeLineFields:
    return ModeLineFields(
        rf_min_mhz=m.line.rf_min_mhz,
        rf_max_mhz=m.line.rf_max_mhz,
        pw_min_us=m.line.pw_min_us,
        pw_max_us=m.line.pw_max_us,
        rf_range_matching=m.line.rf_range_matching,
        pw_range_matching=m.line.pw_range_matching,
        pri_range_matching=m.line.pri_range_matching,
        # Never in the XML (see module docstring) — 0 is the only choice
        # that doesn't fabricate a tolerance the export never recorded.
        rf_delta=0,
        pw_delta=0,
        pri_delta=0 if m.pri_type == PriType.fixed else None,
        frame_time_delta_us=0 if m.pri_type == PriType.stagger else None,
        pri_min_us=m.line.pri_min_us,
        pri_max_us=m.line.pri_max_us,
        jitter_min_us=m.line.jitter_min_us,
        jitter_max_us=m.line.jitter_max_us,
        pri_stagger_values_us=m.line.pri_stagger_values_us,
    )


def plan_import(parsed: ParsedPrsEmitter) -> tuple[list[PlannedPrsMode], list[PrsImportIssue]]:
    """Validates every parsed Mode against the same rules a manually-created
    Mode must satisfy — all-or-nothing, matching the JSON importer's own
    validate-then-commit convention: nothing is written unless every Mode in
    the file checks out, so a partially-bad file never leaves a partially-
    imported Emitter to clean up by hand.
    """
    planned: list[PlannedPrsMode] = []
    issues: list[PrsImportIssue] = []
    for m in parsed.modes:
        label = m.name or "(unnamed Mode)"
        if not m.ew_group_name:
            issues.append(PrsImportIssue(mode_name=label, error="No <ScanData> EW Group link in the XML"))
            continue
        try:
            line_fields = _build_line_fields(m)
            validate_pri_type_fields(m.pri_type, line_fields)
            require_manual_deltas(m.pri_type, line_fields)
        except (ValidationError, ValueError) as exc:
            issues.append(PrsImportIssue(mode_name=label, error=str(exc)))
            continue
        planned.append(PlannedPrsMode(parsed=m, line_fields=line_fields))
    return planned, issues


@dataclass
class PrsImportResult:
    source_id: uuid.UUID
    created_ew_group_names: list[str]
    created_mode_ids: list[uuid.UUID]


def commit_import(
    db: Session, *, emitter_id: uuid.UUID, parsed: ParsedPrsEmitter, planned: list[PlannedPrsMode], source_id: uuid.UUID
) -> PrsImportResult:
    """Creates whatever EW Groups the plan needs (matched to existing ones by
    exact name, same matching rule the whole PRS round-trip relies on) and
    one Mode + ModeLine per planned entry, all under the given Source.
    """
    existing_groups = {g.name: g for g in db.query(EwGroup).filter(EwGroup.emitter_id == emitter_id).all()}
    created_ew_group_names: list[str] = []
    for peg in parsed.ew_groups:
        if peg.name in existing_groups:
            continue
        group = EwGroup(
            emitter_id=emitter_id,
            name=peg.name,
            scan_min=peg.scan_min,
            scan_max=peg.scan_max,
            threat_priority=peg.threat_priority,
            ageout=peg.ageout,
        )
        db.add(group)
        db.flush()
        existing_groups[peg.name] = group
        created_ew_group_names.append(peg.name)

    created_mode_ids: list[uuid.UUID] = []
    for item in planned:
        m = item.parsed
        group = existing_groups[m.ew_group_name]
        mode = Mode(ew_group_id=group.id, source_id=source_id, name=m.name, pri_type=m.pri_type)
        db.add(mode)
        db.flush()

        line_fields = item.line_fields.model_dump()
        try:
            dsl_text = render_mode_line(
                pri_type=m.pri_type, **{k: v for k, v in line_fields.items() if k not in _NON_DSL_LINE_FIELDS}
            )
        except DslSyntaxError:
            dsl_text = None
        db.add(ModeLine(mode_id=mode.id, dsl_text=dsl_text, **line_fields))
        created_mode_ids.append(mode.id)

    return PrsImportResult(
        source_id=source_id, created_ew_group_names=created_ew_group_names, created_mode_ids=created_mode_ids
    )
