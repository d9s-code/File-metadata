"""The analysis sheet: for the same Platforms and Emitters as the Emitter
report, a workbook to work from rather than to load into the sensor —

- **Modes**: a line per Mode with its Sources and notes, and every value
  twice: as typed, and with its delta (±) applied, in shaded columns;
- **Sources**: each Source with its details, the Modes that cite it and its
  notes;
- **Elements**: each Source's Elements, as typed and with their delta;
- **Notes**: the Emitters' analyst notes and their Sources' notes;
- **Key**: what the sheets and the shading mean.

Emitters are as in the Emitter report: a Platform's as the versions it pins,
one picked on its own as its latest saved version. Notes are as they are
now (they aren't versioned)."""

from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from app.models.emitter_note import EmitterNote
from app.models.source_group import SourceGroup
from app.models.source_note import SourceNote
from app.services.delta import apply_delta
from app.services.emitter_report_service import PRI_TYPE_NAMES, _n, _name_key, report_emitters
from app.services.frametime_service import effective_frametime_us
from app.services.xlsx_writer import Sheet, write_xlsx

ELEMENT_UNITS = {"rf": "MHz", "pri": "µs", "pw": "µs", "scan": "s"}


def _note_text(note) -> str:
    who = note.author.username if note.author else "?"
    return f"{note.body} ({who}, {note.created_at:%d.%m.%Y})"


def _range(lo, hi, delta) -> list:
    """As typed (min, max), the delta, and with it applied (min, max)."""
    if lo is None and hi is None:
        return [None] * 5
    with_delta = apply_delta(lo, hi if hi is not None else lo, delta)
    return [_n(lo), _n(hi if hi is not None else lo), _n(delta), _n(with_delta[0]), _n(with_delta[1])]


def _yes(value) -> str | None:
    return None if value is None else ("Yes" if value else "No")


MODE_HEADER = [
    "Platform", "Emitter", "Designation", "Version", "EW Group", "Mode", "PRI Type", "Sources",
    "Quality", "Quantity",
    "RF Min [MHz]", "RF Max [MHz]", "RF ± [MHz]", "RF Min ±Δ [MHz]", "RF Max ±Δ [MHz]", "RF Range Matching",
    "PW Min [µs]", "PW Max [µs]", "PW ± [µs]", "PW Min ±Δ [µs]", "PW Max ±Δ [µs]", "PW Range Matching",
    "PRI Min [µs]", "PRI Max [µs]", "PRI ± [µs]", "PRI Min ±Δ [µs]", "PRI Max ±Δ [µs]",
    "Jitter Min [µs]", "Jitter Max [µs]", "PRI Range Matching",
    "Stagger Steps [µs]", "Frame Time [µs]", "Frame ± [µs]", "Frame Min ±Δ [µs]", "Frame Max ±Δ [µs]",
    "Scan Min [ms]", "Scan Max [ms]", "Scan ± [ms]", "Scan Min ±Δ [ms]", "Scan Max ±Δ [ms]",
    "Mode Notes",
]  # fmt: skip
# The columns with a delta applied — shaded, to tell them from the values as typed.
MODE_SHADED = {MODE_HEADER.index(h) for h in MODE_HEADER if "±Δ" in h}


def _ms(value):
    return None if value is None else float(value) * 1000


def _mode_row(platform, snapshot: dict, number, group: dict, mode: dict) -> list:
    line = mode.get("line") or {}
    pri_type = mode.get("pri_type")
    pri = [None] * 5
    jitter = [None, None]
    steps = frame = None
    frame_cols = [None] * 4
    if pri_type == "fixed":
        pri = _range(line.get("pri_min_us"), line.get("pri_max_us"), line.get("pri_delta"))
        jitter = [_n(line.get("jitter_min_us")), _n(line.get("jitter_max_us"))]
    elif pri_type == "stagger":
        values = line.get("pri_stagger_values_us") or []
        steps = ", ".join(f"{float(v):g}" for v in values) or None
        frame = effective_frametime_us(values, line.get("explicit_frame_time_us"))
        if frame is not None:
            _lo, _hi, delta, lo, hi = _range(frame, frame, line.get("frame_time_delta_us"))
            frame_cols = [_n(frame), delta, lo, hi]
    scan = _range(_ms(group.get("scan_min")), _ms(group.get("scan_max")), _ms(group.get("scan_delta")))
    return [
        platform,
        snapshot.get("name"),
        snapshot.get("designation"),
        f"v{number}" if number else "unsaved",
        group.get("name"),
        mode.get("name"),
        PRI_TYPE_NAMES.get(pri_type, pri_type),
        "; ".join(n for n in (mode.get("source_names") or [mode.get("source_name")]) if n),
        mode.get("confirmation_quality"),
        mode.get("confirmation_quantity"),
        *_range(line.get("rf_min_mhz"), line.get("rf_max_mhz"), line.get("rf_delta")),
        _yes(line.get("rf_range_matching")),
        *_range(line.get("pw_min_us"), line.get("pw_max_us"), line.get("pw_delta")),
        _yes(line.get("pw_range_matching")),
        *pri,
        *jitter,
        _yes(line.get("pri_range_matching")),
        steps,
        *frame_cols,
        *scan,
        mode.get("notes"),
    ]


def build_analysis(db: Session, platform_ids: list[UUID], emitter_ids: list[UUID]) -> bytes:
    emitters = report_emitters(db, platform_ids, emitter_ids)
    source_ids = {UUID(s["id"]) for _p, snap, _n2 in emitters for s in snap.get("sources", [])}
    emitter_uuids = {UUID(snap["id"]) for _p, snap, _n2 in emitters}
    source_notes: dict[str, list] = {}
    for note in (
        db.query(SourceNote).options(joinedload(SourceNote.author)).filter(SourceNote.source_id.in_(source_ids)).order_by(SourceNote.created_at)
    ):
        source_notes.setdefault(str(note.source_id), []).append(note)
    emitter_notes: dict[str, list] = {}
    for note in (
        db.query(EmitterNote).options(joinedload(EmitterNote.author)).filter(EmitterNote.emitter_id.in_(emitter_uuids)).order_by(EmitterNote.created_at)
    ):
        emitter_notes.setdefault(str(note.emitter_id), []).append(note)
    group_names = dict(db.query(SourceGroup.id, SourceGroup.name).all())

    modes = [MODE_HEADER]
    sources = [["Platform", "Emitter", "Designation", "Version", "Source", "Date", "Type", "Group", "RF Legacy Term",
                "PRI Legacy Term", "Description", "Modes Citing It", "Elements", "Notes"]]  # fmt: skip
    elements = [["Emitter", "Source", "Type", "Unit", "Label", "Variant", "Min", "Max", "±", "Min ±Δ", "Max ±Δ",
                 "Jitter Min", "Jitter Max", "Stagger Values", "Details"]]  # fmt: skip
    notes = [["Emitter", "About", "Author", "Date", "Note"]]
    seen_emitters: set[str] = set()
    for platform, snapshot, number in emitters:
        groups = snapshot.get("ew_groups", [])
        pairs = sorted(((g, m) for g in groups for m in g.get("modes", [])), key=lambda gm: _name_key(gm[1].get("name")))
        for group, mode in pairs:
            modes.append(_mode_row(platform, snapshot, number, group, mode))
        if not pairs:
            modes.append([platform, snapshot.get("name"), snapshot.get("designation"), f"v{number}" if number else "unsaved"])
        # Sources, Elements and notes once per Emitter, even on two Platforms.
        if snapshot["id"] in seen_emitters:
            continue
        seen_emitters.add(snapshot["id"])
        for source in sorted(snapshot.get("sources", []), key=lambda s: _name_key(s.get("name"))):
            citing = [m.get("name") for _g, m in pairs if source["name"] in (m.get("source_names") or [m.get("source_name")])]
            group_id = source.get("group_id")
            sources.append([
                platform, snapshot.get("name"), snapshot.get("designation"), f"v{number}" if number else "unsaved",
                source.get("name"), source.get("source_date"), source.get("source_type"),
                group_names.get(UUID(group_id)) if group_id else None,
                source.get("rf_legacy_term"), source.get("pri_legacy_term"), source.get("description"),
                ", ".join(citing) or None, len(source.get("elements", [])),
                "\n".join(_note_text(n) for n in source_notes.get(source["id"], [])) or None,
            ])  # fmt: skip
            for e in source.get("elements", []):
                kind = e.get("element_type")
                stagger = e.get("stagger_values")
                if stagger:
                    ranged = [None, None, _n(e.get("delta")), None, None]
                else:
                    ranged = _range(e.get("value_min"), e.get("value_max"), e.get("delta"))
                elements.append([
                    snapshot.get("name"), source.get("name"), (kind or "").upper(), ELEMENT_UNITS.get(kind),
                    e.get("label"), e.get("variant"), *ranged, _n(e.get("jitter_min")), _n(e.get("jitter_max")),
                    ", ".join(f"{float(v):g}" for v in stagger) if stagger else None, e.get("details"),
                ])  # fmt: skip
            for note in source_notes.get(source["id"], []):
                notes.append([snapshot.get("name"), f"Source {source['name']}", note.author.username if note.author else None,
                              f"{note.created_at:%d.%m.%Y}", note.body])  # fmt: skip
        for note in emitter_notes.get(snapshot["id"], []):
            notes.append([snapshot.get("name"), "Emitter", note.author.username if note.author else None,
                          f"{note.created_at:%d.%m.%Y}", note.body])  # fmt: skip

    key = [
        ["Analysis sheet"],
        [],
        ["Modes", "A line per Mode: its Sources, confirmation, every value as typed and with its delta, and its notes."],
        ["Sources", "Each Source of the Emitters, with the Modes that cite it and its notes."],
        ["Elements", "Each Source's Elements, as typed and with their delta."],
        ["Notes", "The Emitters' analyst notes and their Sources' notes."],
        [],
        ["Shaded columns", "Values with the delta (±) applied — the range the sensor matches. The others are as typed."],
        ["±", "The delta: how far each value is widened either way. Empty when none is set."],
        ["Version", "A Platform's Emitters are as the version it pins; an Emitter picked on its own, as its latest saved version."],
        ["Notes", "As they are now — notes aren't versioned."],
    ]
    return write_xlsx(
        [
            Sheet(name="Modes", rows=modes, widths=[16, 22, 12, 8, 14, 20, 9, 26, 8, 8] + [11] * 30 + [40], shaded=MODE_SHADED),
            Sheet(name="Sources", rows=sources, widths=[16, 22, 12, 8, 24, 11, 14, 16, 14, 14, 30, 30, 9, 50]),
            Sheet(name="Elements", rows=elements, widths=[22, 24, 7, 6, 18, 10, 10, 10, 8, 10, 10, 10, 10, 20, 30], shaded={9, 10}),
            Sheet(name="Notes", rows=notes, widths=[22, 24, 14, 11, 80]),
            Sheet(name="Key", rows=key, header_row=None, widths=[16, 100]),
        ]
    )
