"""The Emitter report: a spreadsheet laid out exactly like the report the
other app makes after an import — a "Platforms" sheet and an "Emitters"
sheet, with the same headers letter for letter — so the two can be put side
by side with scripts/compare_reports.py and any difference flagged.

Every value is read back from the PRS export's own XML (the elements
prs_export.serializer builds), so the report shows what was exported, not a
second reading of the data: names with spaces as underscores, frequency,
pulse width, PRI and frame time with their deltas applied, the scan period
in ms. As in the export, each Platform and each Emitter appears once by name
(an Emitter pinned on two Platforms: the first pin met), plus the Unknown
Platform and Emitter every export carries. Polarization isn't kept in this
app or exported; the other app reports "IGNORED" then, and so does this.

An MDF's report is for one saved MDF version (the latest, by default) — the
same snapshot its export is made from. The Platforms-and-Emitters report
takes the Platforms' current pins and each Emitter picked on its own at its
latest saved version."""

import re
from uuid import UUID

from lxml import etree
from sqlalchemy.orm import Session

from app.models.emitter import Emitter
from app.models.emitter_version import EmitterVersion
from app.models.platform import Platform
from app.services.prs_export.packager import _template_bytes, mdf_export_contents
from app.services.prs_export.serializer import build_emitter_element, build_platform_element
from app.services.snapshots import build_emitter_snapshot
from app.services.xlsx_writer import Sheet, write_xlsx

STAGGER_COLUMNS = 32

# The other app's headers, exactly — the odd spots included: a no-break space
# in "Jitter Max [µs]" and "Frame Min [µs]", and a small m in "Frame max".
PLATFORM_HEADER = ["Name", "Hostility", "Base", "Speed Low", "Speed High", "Speed Unit", "TRL 1", "TRL 2", "TRL 3"]
HEADER = [
    "Emitter",
    "ELNOT",
    "Mode",
    "Polarization",
    "Ageout [s]",
    "Threat Priority",
    "Quality",
    "Quantity",
    "Scan Type",
    "Period Min [ms]",
    "Period Max [ms]",
    "Frequency Min [MHz]",
    "Frequency Max [MHz]",
    "Pulse Width Min [µs]",
    "Pulse Width Max [µs]",
    "PRI Type",
    "PRI Min [µs]",
    "PRI Max [µs]",
    "Jitter Min [µs]",
    "Jitter Max\u00a0[µs]",
    "Frame Min\u00a0[µs]",
    "Frame max [µs]",
]
POLARIZATION = "IGNORED"
# The export's tag for the designation has the same name as its column.
_DESIGNATION_TAG = HEADER[1]

# Used by the analysis sheet (analysis_report_service).
PRI_TYPE_NAMES = {"fixed": "Fixed", "stagger": "Stagger", "cw": "CW", "xlet": "Xlet"}


class ReportError(ValueError):
    pass


def _n(value):
    """A number as the sheet shows it: rounded, so float noise never shows."""
    return None if value is None else round(float(value), 4)


def _num(text: str | None, scale: float = 1):
    """An exported attribute as a number cell (None when it isn't there)."""
    if text is None or text == "":
        return None
    try:
        value = round(float(text) * scale, 6)
    except ValueError:
        return text
    return int(value) if value.is_integer() else value


def _attr(element, path: str, name: str = "Value"):
    found = element.find(path) if element is not None else None
    return None if found is None else found.get(name)


def emitter_rows(element) -> list[list]:
    """The Emitters sheet's lines for one exported Emitter element: a line per
    Mode, or one line with only the names when it has none."""
    name = element.get("Name")
    designation = element.findtext(_DESIGNATION_TAG)
    params = {p.get("SetId"): p for p in element.findall("EWParameters")}
    scans: dict[str, etree._Element] = {}
    for scan in element.findall("Scan"):
        scans.setdefault(scan.get("Name"), scan)
    rows = []
    for mode in element.findall("Mode"):
        scan = scans.get(_attr(mode, "ScanData", "Name"))
        group = params.get(_attr(scan, "EWParametersRef", "SetId")) if scan is not None else None
        pri = mode.find("PRI")
        pri_values = [None] * 6  # PRI min/max, jitter min/max, frame min/max
        steps: list = []
        if pri is not None:
            pri_values = [
                _num(_attr(pri, "SimplePRI", "Min")),
                _num(_attr(pri, "SimplePRI", "Max")),
                _num(_attr(pri, "Jitter", "Min")),
                _num(_attr(pri, "Jitter", "Max")),
                _num(_attr(pri, "FramePeriod", "Min")),
                _num(_attr(pri, "FramePeriod", "Max")),
            ]
            steps = [_num(level.get("Value")) for level in pri.findall("StaggerLevels/Level")]
        rows.append(
            [
                name,
                designation,
                mode.get("Name"),
                POLARIZATION,
                _num(_attr(group, "Ageout")),
                _num(_attr(group, "ThreatPriority")),
                _num(_attr(mode, "ConfirmationQuality")),
                _num(_attr(mode, "ConfirmationQuantity")),
                scan.findtext("Class") if scan is not None else None,
                _num(_attr(scan, "Period", "Min"), 1000),
                _num(_attr(scan, "Period", "Max"), 1000),
                _num(_attr(mode, "Frequency", "Min")),
                _num(_attr(mode, "Frequency", "Max")),
                _num(_attr(mode, "PulseWidth", "Min")),
                _num(_attr(mode, "PulseWidth", "Max")),
                pri.get("Class") if pri is not None else None,
                *pri_values,
                *steps,
            ]
        )
    rows.sort(key=lambda r: _name_key(r[2]))
    return rows or [[name, designation]]


def platform_row(element) -> list:
    """The Platforms sheet's line for one exported Platform element."""
    return [
        element.findtext("Name"),
        _attr(element, "Hostility"),
        _attr(element, "Base"),
        _num(_attr(element, "Speed", "Min")),
        _num(_attr(element, "Speed", "Max")),
        _attr(element, "Speed", "Units"),
    ]


def _template(filename: str):
    return etree.fromstring(_template_bytes(filename))


def _workbook(platform_snapshots: list[dict], emitter_snapshots: list[dict]) -> bytes:
    """The two sheets for these Platform and Emitter snapshots, each read back
    from its exported element, after the Unknown Platform and Emitter."""
    platforms = sorted((build_platform_element(s) for s in platform_snapshots), key=lambda e: _name_key(e.findtext("Name")))
    emitters = sorted((build_emitter_element(s) for s in emitter_snapshots), key=lambda e: _name_key(e.get("Name")))
    platform_lines = [platform_row(e) for e in [_template("default_unknown_platform.xml"), *platforms]]
    emitter_lines = [r for e in [_template("default_unknown_emitter.xml"), *emitters] for r in emitter_rows(e)]
    steps = max([STAGGER_COLUMNS, *(len(r) - len(HEADER) for r in emitter_lines)])
    header = HEADER + [f"Stagger {i} [µs]" for i in range(1, steps + 1)]
    return write_xlsx(
        [
            Sheet(name="Platforms", rows=[PLATFORM_HEADER, *platform_lines], widths=[24, 12, 12, 11, 11, 11, 8, 8, 8]),
            Sheet(name="Emitters", rows=[header, *emitter_lines], widths=[24, 14, 22] + [12] * (len(header) - 3)),
        ]
    )


def _name_key(name: str | None) -> list:
    """Alphabetical, ignoring case, with numbers compared by value."""
    return [(0, int(part), "") if part.isdigit() else (1, 0, part) for part in re.split(r"(\d+)", (name or "").casefold())]


def _latest(db: Session, emitter: Emitter) -> tuple[dict, int | None]:
    latest = (
        db.query(EmitterVersion)
        .filter(EmitterVersion.emitter_id == emitter.id)
        .order_by(EmitterVersion.version_number.desc())
        .first()
    )
    return (latest.snapshot, latest.version_number) if latest is not None else (build_emitter_snapshot(emitter), None)


def report_emitters(db: Session, platform_ids: list[UUID], emitter_ids: list[UUID]) -> list[tuple[str | None, dict, int | None]]:
    """The Emitters reported, in the report's order: each with its Platform
    (None for one picked on its own), its snapshot and its version number
    (None when it has never been saved)."""
    platforms = db.query(Platform).filter(Platform.id.in_(platform_ids), Platform.is_deleted.is_(False)).all() if platform_ids else []
    emitters = db.query(Emitter).filter(Emitter.id.in_(emitter_ids), Emitter.is_deleted.is_(False)).all() if emitter_ids else []
    if len(platforms) != len(set(platform_ids)) or len(emitters) != len(set(emitter_ids)):
        raise ReportError("Some of the Platforms or Emitters picked weren't found — reload the page and pick again")
    if not platforms and not emitters:
        raise ReportError("Pick at least one Platform or Emitter")

    out: list[tuple[str | None, dict, int | None]] = []
    on_platforms: set[UUID] = set()
    for platform in sorted(platforms, key=lambda p: _name_key(p.name)):
        pinned = [
            (link.emitter_version.snapshot, link.emitter_version.version_number)
            for link in platform.links
            if link.emitter_version is not None and not (link.emitter and link.emitter.is_deleted)
        ]
        on_platforms.update(link.emitter_id for link in platform.links)
        for snapshot, number in sorted(pinned, key=lambda sv: _name_key(sv[0].get("name"))):
            out.append((platform.name, snapshot, number))
    loose = [_latest(db, e) for e in emitters if e.id not in on_platforms]
    for snapshot, number in sorted(loose, key=lambda sv: _name_key(sv[0].get("name"))):
        out.append((None, snapshot, number))
    return out


def build_report(db: Session, platform_ids: list[UUID], emitter_ids: list[UUID]) -> bytes:
    """The report for the Platforms and Emitters picked: each Platform with
    its current pins, and any Emitter picked on its own."""
    reported = report_emitters(db, platform_ids, emitter_ids)
    platforms = db.query(Platform).filter(Platform.id.in_(platform_ids)).all() if platform_ids else []
    emitters: dict[str, dict] = {}
    for _platform, snapshot, _number in reported:
        emitters.setdefault(snapshot.get("name"), snapshot)
    return _workbook([{"name": p.name} for p in platforms], list(emitters.values()))


# --- An MDF's report -----------------------------------------------------------------


def mdf_report_snapshot(db: Session, mdf_id: UUID, version_number: int | None = None) -> tuple[dict, int]:
    """The MDF version a report is for: the one asked for, else the latest
    saved — as (snapshot, version number)."""
    from app.models.mdf import MdfVersion

    query = db.query(MdfVersion).filter(MdfVersion.mdf_id == mdf_id)
    if version_number is not None:
        version = query.filter(MdfVersion.version_number == version_number).one_or_none()
        if version is None:
            raise ReportError(f"This MDF has no version {version_number}")
    else:
        version = query.order_by(MdfVersion.version_number.desc()).first()
        if version is None:
            raise ReportError("This MDF has no saved version yet — save one, then make the report")
    return version.snapshot, version.version_number


def build_mdf_report(db: Session, mdf_id: UUID, version_number: int | None = None) -> tuple[bytes, int]:
    """The report for an MDF version, from the same snapshot its export is
    made of — as (the workbook, the version number)."""
    snapshot, number = mdf_report_snapshot(db, mdf_id, version_number)
    platforms, emitters = mdf_export_contents(snapshot)
    if not emitters:
        raise ReportError(f"Version {number} of this MDF has no Emitters — pin a Platform that pins some, then save")
    return _workbook(platforms, emitters), number
