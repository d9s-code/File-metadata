"""One parameter value — a stray PRI seen in a test, say — added to the
Emitter's Modes: one new Mode per combination of the other two parameters
the Modes already have, a copy of a Mode with that combination with only
the one parameter changed.

The combinations are the distinct values of the other two parameters (with
their margins and range matching) among the Emitter's Modes, per EW Group;
the person picks which apply. A combination whose Mode already has the new
value is skipped, as a duplicate would be."""

from uuid import UUID

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.enums import PriType
from app.models.ew_group import EwGroup
from app.models.mode import Mode, ModeGenerationBatch
from app.schemas.mode import ModeCreate, ModeLineFields

# Each parameter's line fields: what changes when it's the one added.
PARAM_FIELDS = {
    "rf": ["rf_min_mhz", "rf_max_mhz", "rf_delta", "rf_range_matching"],
    "pw": ["pw_min_us", "pw_max_us", "pw_delta", "pw_range_matching"],
    "pri": [
        "pri_min_us",
        "pri_max_us",
        "jitter_min_us",
        "jitter_max_us",
        "pri_delta",
        "pri_stagger_values_us",
        "frame_time_delta_us",
        "explicit_frame_time_us",
        "pri_range_matching",
        "type_data",
    ],
}
LINE_FIELDS = list(ModeLineFields.model_fields)


class ParameterError(ValueError):
    pass


def _num(v):
    return None if v is None else float(v)


def _line_dict(mode: Mode) -> dict:
    line = mode.line
    out = {}
    for f in LINE_FIELDS:
        v = getattr(line, f)
        if f == "pri_stagger_values_us":
            v = [float(x) for x in v] if v else None
        elif isinstance(v, bool) or v is None or f == "type_data":
            pass
        else:
            v = float(v)
        out[f] = v
    return out


def _span(lo, hi, unit: str, delta=None) -> str:
    text = f"{lo:g}" if lo == hi or hi is None else f"{lo:g}–{hi:g}"
    return f"{text} {unit}" + (f" (±{delta:g})" if delta else "")


def _pri_text(pri_type: PriType, line: dict) -> str:
    if pri_type == PriType.stagger:
        return "stagger " + ", ".join(f"{v:g}" for v in line.get("pri_stagger_values_us") or []) + " µs"
    if pri_type == PriType.cw:
        return "CW"
    if line.get("pri_min_us") is None:
        return "PRI —"
    text = "PRI " + _span(line["pri_min_us"], line["pri_max_us"], "µs", line.get("pri_delta"))
    if line.get("jitter_min_us") is not None:
        text += f", jitter {_span(line['jitter_min_us'], line['jitter_max_us'], '').strip()}"
    return text


def _others_text(parameter: str, pri_type: PriType, line: dict) -> str:
    parts = []
    if parameter != "rf":
        parts.append("RF " + _span(line["rf_min_mhz"], line["rf_max_mhz"], "MHz", line.get("rf_delta")))
    if parameter != "pri":
        parts.append(_pri_text(pri_type, line))
    if parameter != "pw":
        parts.append("PW " + _span(line["pw_min_us"], line["pw_max_us"], "µs", line.get("pw_delta")))
    return " · ".join(parts)


def value_text(parameter: str, pri_type: PriType | None, values: dict) -> str:
    if parameter == "rf":
        return "RF " + _span(values.get("rf_min_mhz"), values.get("rf_max_mhz"), "MHz")
    if parameter == "pw":
        return "PW " + _span(values.get("pw_min_us"), values.get("pw_max_us"), "µs")
    return _pri_text(pri_type or PriType.fixed, {**values, "pri_delta": None})


def _new_line(parameter: str, base: dict, values: dict, pri_type: PriType | None) -> dict:
    line = dict(base)
    for f in PARAM_FIELDS[parameter]:
        if f in values:
            line[f] = values[f]
        elif f.endswith("_range_matching"):
            line[f] = base[f]
        else:
            line[f] = None
    if parameter == "pri" and pri_type == PriType.stagger:
        for f in ("pri_min_us", "pri_max_us", "jitter_min_us", "jitter_max_us", "pri_delta"):
            line[f] = None
    if parameter == "pri" and pri_type == PriType.fixed:
        for f in ("pri_stagger_values_us", "frame_time_delta_us", "explicit_frame_time_us"):
            line[f] = None
    line["type_data"] = None if parameter == "pri" else base.get("type_data")
    return line


def _signature(pri_type: PriType | None, line: dict, fields: list[str]) -> tuple:
    return (pri_type.value if pri_type else None, *(tuple(line[f]) if isinstance(line[f], list) else line[f] for f in fields))


def plan(db: Session, emitter_id: UUID, parameter: str, values: dict, pri_type: PriType | None) -> list[dict]:
    """Every combination of the other two parameters among the Emitter's
    Modes, per EW Group: its Modes, and whether one of them has the value
    already."""
    if parameter not in PARAM_FIELDS:
        raise ParameterError("Pick RF, PRI or PW")
    other_fields = [f for f in LINE_FIELDS if f not in PARAM_FIELDS[parameter] and f != "type_data"]
    modes = (
        db.query(Mode)
        .join(EwGroup, Mode.ew_group_id == EwGroup.id)
        .filter(EwGroup.emitter_id == emitter_id)
        .order_by(EwGroup.sort_order, Mode.sort_order, Mode.name)
        .all()
    )
    rows: dict[tuple, dict] = {}
    for mode in modes:
        if mode.line is None:
            continue
        line = _line_dict(mode)
        # For RF or PW the PRI type stays the Mode's, so it's part of the
        # combination; for PRI the new one replaces it.
        key_type = None if parameter == "pri" else mode.pri_type
        key = (str(mode.ew_group_id), _signature(key_type, line, other_fields))
        row = rows.get(key)
        if row is None:
            row = rows[key] = {
                "key": f"{mode.ew_group_id}:{mode.id}",
                "ew_group_id": mode.ew_group_id,
                "ew_group_name": mode.ew_group.name,
                "label": _others_text(parameter, mode.pri_type, line),
                "template": mode,
                "mode_ids": [],
                "mode_names": [],
                "has_value": False,
            }
        row["mode_ids"].append(mode.id)
        row["mode_names"].append(mode.name)
        new_type = pri_type if parameter == "pri" else mode.pri_type
        if mode.pri_type == new_type and all(
            (line[f] == values.get(f)) for f in PARAM_FIELDS[parameter] if f in values
        ):
            row["has_value"] = True
    return list(rows.values())


def add(
    db: Session,
    emitter_id: UUID,
    *,
    parameter: str,
    values: dict,
    pri_type: PriType | None,
    row_keys: list[str],
    name_suffix: str,
    extra_source_ids: list[UUID],
    derived_from_test_record_id: UUID | None,
    actor_id,
    create_mode,
) -> tuple[list[Mode], list[str]]:
    """The new Modes, one per picked combination (all or none: one that
    doesn't validate refuses the lot), and the combinations skipped as
    already having the value. `create_mode(db, ew_group, payload, actor_id,
    batch_id)` makes each."""
    rows = {r["key"]: r for r in plan(db, emitter_id, parameter, values, pri_type)}
    unknown = [k for k in row_keys if k not in rows]
    if unknown:
        raise ParameterError("The Modes changed since this was shown — open it again")
    picked = [rows[k] for k in row_keys]
    payloads, skipped, problems = [], [], []
    for row in picked:
        if row["has_value"]:
            skipped.append(f"{row['label']} ({row['ew_group_name']}): {', '.join(row['mode_names'])} has it already")
            continue
        template: Mode = row["template"]
        line = _new_line(parameter, _line_dict(template), values, pri_type)
        taken = {m.name for m in template.ew_group.modes}
        name = f"{template.name} {name_suffix}".strip()
        n = 2
        while name in taken:
            name, n = f"{template.name} {name_suffix} ({n})", n + 1
        source_ids = list(dict.fromkeys([*template.source_ids, *extra_source_ids]))
        try:
            payload = ModeCreate(
                name=name,
                pri_type=pri_type if parameter == "pri" else template.pri_type,
                source_ids=source_ids,
                confirmation_quality=template.confirmation_quality,
                confirmation_quantity=template.confirmation_quantity,
                line=line,
                derived_from_test_record_ids=[derived_from_test_record_id] if derived_from_test_record_id else [],
            )
        except ValidationError as err:
            problems.append(f"{name}: {err.errors()[0]['msg']}")
            continue
        payloads.append((template.ew_group, payload))
    if problems:
        raise ParameterError("; ".join(problems))

    created, batches = [], {}
    for group, payload in payloads:
        if group.id not in batches:
            batch = ModeGenerationBatch(
                ew_group_id=group.id, source_id=payload.all_source_ids()[0], name_prefix=name_suffix, created_by=actor_id
            )
            db.add(batch)
            db.flush()
            batches[group.id] = batch
        created.append(create_mode(db, group, payload, actor_id, batches[group.id].id))
    return created, skipped
