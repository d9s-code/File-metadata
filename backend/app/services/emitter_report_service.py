"""The Emitter report: a spreadsheet with a line per Mode of the Platforms
and Emitters picked — Platforms in alphabetical order, each one's Emitters
alphabetically under it, and each Emitter's Modes alphabetically (numbers
by value: "Search 2" before "Search 10"); then any Emitter picked that
isn't on one of those Platforms. An Emitter without Modes gets a line of
its own with the Mode's columns empty.

A Platform's Emitters are reported as the versions it pins; an Emitter
picked on its own as its latest saved version (as it is now, if it has
never been saved). Values are those the PRS export writes: frequency, pulse
width, PRI and frame time with their margins applied."""

import re
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.emitter import Emitter
from app.models.emitter_version import EmitterVersion
from app.models.platform import Platform
from app.services.delta import apply_delta
from app.services.frametime_service import effective_frametime_us
from app.services.snapshots import build_emitter_snapshot
from app.services.xlsx_writer import Sheet, write_xlsx

STAGGER_COLUMNS = 32

# The report's header, as the export format has it (plus Platform in front).
HEADER = [
    "Platform",
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
    "Jitter Max [µs]",
    "Frame Min [µs]",
    "Frame Max [µs]",
]

PRI_TYPE_NAMES = {"fixed": "Fixed", "stagger": "Stagger", "cw": "CW", "xlet": "Xlet"}


class ReportError(ValueError):
    pass


def _n(value):
    """A number as the sheet shows it: rounded, so float noise never shows."""
    return None if value is None else round(float(value), 4)


def _ms(seconds):
    return None if seconds is None else round(float(seconds) * 1000, 4)


def _mode_row(platform: str | None, snapshot: dict, group: dict, mode: dict) -> list:
    line = mode.get("line") or {}
    pri_type = mode.get("pri_type")
    rf = apply_delta(line.get("rf_min_mhz"), line.get("rf_max_mhz"), line.get("rf_delta"))
    pw = apply_delta(line.get("pw_min_us"), line.get("pw_max_us"), line.get("pw_delta"))
    pri = jitter = frame = (None, None)
    steps: list = []
    if pri_type == "fixed":
        pri = apply_delta(line.get("pri_min_us"), line.get("pri_max_us"), line.get("pri_delta"))
        jitter = (line.get("jitter_min_us"), line.get("jitter_max_us"))
    elif pri_type == "stagger":
        steps = line.get("pri_stagger_values_us") or []
        frame_time = effective_frametime_us(steps, line.get("explicit_frame_time_us"))
        if frame_time is not None:
            frame = apply_delta(frame_time, frame_time, line.get("frame_time_delta_us"))
    return [
        platform,
        snapshot.get("name"),
        snapshot.get("designation"),
        mode.get("name"),
        None,  # Polarization: not kept in the app.
        _n(group.get("ageout")),
        group.get("threat_priority"),
        mode.get("confirmation_quality"),
        mode.get("confirmation_quantity"),
        None,  # Scan Type: not kept in the app.
        _ms(group.get("scan_min")),
        _ms(group.get("scan_max")),
        _n(rf[0]),
        _n(rf[1]),
        _n(pw[0]),
        _n(pw[1]),
        PRI_TYPE_NAMES.get(pri_type, pri_type),
        _n(pri[0]),
        _n(pri[1]),
        _n(jitter[0]),
        _n(jitter[1]),
        _n(frame[0]),
        _n(frame[1]),
        *[_n(v) for v in steps],
    ]


def _name_key(name: str | None) -> list:
    """Alphabetical, ignoring case, with numbers compared by value."""
    return [(0, int(part), "") if part.isdigit() else (1, 0, part) for part in re.split(r"(\d+)", (name or "").casefold())]


def _emitter_rows(platform: str | None, snapshot: dict) -> list[list]:
    modes = [(group, mode) for group in snapshot.get("ew_groups", []) for mode in group.get("modes", [])]
    modes.sort(key=lambda gm: _name_key(gm[1].get("name")))
    if not modes:
        # Still listed, so an Emitter without Modes doesn't drop out unseen.
        return [[platform, snapshot.get("name"), snapshot.get("designation")]]
    return [_mode_row(platform, snapshot, group, mode) for group, mode in modes]


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


def build_report_rows(db: Session, platform_ids: list[UUID], emitter_ids: list[UUID]) -> list[list]:
    """The header, then a line per Mode, in the report's order."""
    rows: list[list] = []
    for platform, snapshot, _number in report_emitters(db, platform_ids, emitter_ids):
        rows.extend(_emitter_rows(platform, snapshot))

    steps = max([STAGGER_COLUMNS, *(len(r) - len(HEADER) for r in rows)])
    return [HEADER + [f"Stagger {i} [µs]" for i in range(1, steps + 1)], *rows]


def build_report(db: Session, platform_ids: list[UUID], emitter_ids: list[UUID]) -> bytes:
    rows = build_report_rows(db, platform_ids, emitter_ids)
    widths = [18, 22, 14, 22] + [12] * (len(rows[0]) - 4)
    return write_xlsx([Sheet(name="Report", rows=rows, widths=widths)])
