"""Merging two Modes an ambiguity check found to be the same.

One Mode is kept and widened to cover both — the union of their ranges, the
wider of their margins — and the other is deleted. What pointed at the
deleted Mode (intercept entries it was derived from, test records and test
lines) is moved to the kept one, so no history is lost, and the kept Mode's
notes say what was merged into it.

It works on the Emitter's live data (its draft), like any edit, so it needs
the Emitter checked out by whoever merges; the change reaches the ambiguity
check once a version is saved and the check run again. The preview says what
would change, including any overlap with the Emitter's other Modes that the
wider ranges would create or worsen.
"""

from datetime import datetime, timezone

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.enums import AuditAction, AuditEntityType, PriType
from app.dsl.exceptions import DslSyntaxError
from app.dsl.renderer import render_mode_line
from app.models.ambiguity import AmbiguityFinding
from app.models.emitter import Emitter
from app.models.intercept import InterceptEntryMode
from app.models.mode import Mode
from app.models.test_line import TestLine
from app.models.test_record import TestRecordLineMode, TestRecordMode
from app.schemas.mode import NON_DSL_LINE_FIELDS, ModeLineFields, require_manual_deltas, validate_pri_type_fields
from app.services.ambiguity_service import (
    DEFAULT_TOLERANCE,
    FlatModeLine,
    compared_line,
    compute_pairwise_findings,
    flatten_emitter_snapshot,
)
from app.services.audit_service import apply_and_diff, record_audit, snapshot
from app.services.mode_sources import add_mode_sources, sources_label
from app.services.snapshots import build_emitter_snapshot

SEVERITY_RANK = {"none": 0, "low": 1, "medium": 2, "high": 3, "exact_overlap": 4}

# Ranges whose union the kept Mode takes, and margins it takes the wider of.
_RANGES = (("rf_min_mhz", "rf_max_mhz"), ("pw_min_us", "pw_max_us"), ("pri_min_us", "pri_max_us"), ("jitter_min_us", "jitter_max_us"))
_MARGINS = ("rf_delta", "pw_delta", "pri_delta", "frame_time_delta_us")
_MATCHING = ("rf_range_matching", "pw_range_matching", "pri_range_matching")


class MergeProblem(Exception):
    """These two can't be merged — the message says why."""


def _modes(db: Session, finding: AmbiguityFinding, keep: str) -> tuple[Mode, Mode]:
    if keep not in ("a", "b"):
        raise MergeProblem("Say which Mode to keep: a or b")
    kept_id, removed_id = (
        (finding.mode_id_a, finding.mode_id_b) if keep == "a" else (finding.mode_id_b, finding.mode_id_a)
    )
    kept, removed = db.get(Mode, kept_id), db.get(Mode, removed_id)
    if kept is None or removed is None:
        kept_side, removed_side = ("mode_a", "mode_b") if keep == "a" else ("mode_b", "mode_a")
        side = (finding.details or {}).get(kept_side if kept is None else removed_side) or {}
        raise MergeProblem(f'"{side.get("mode_name", "A Mode")}" no longer exists — it was deleted or already merged')
    if kept.source.emitter_id != removed.source.emitter_id:
        raise MergeProblem("They belong to different Emitters — only Modes of the same Emitter can be merged")
    if kept.pri_type != removed.pri_type:
        raise MergeProblem(
            f"They have different PRI types ({kept.pri_type.value} and {removed.pri_type.value}) — "
            "a merged Mode can have only one"
        )
    if kept.line is None or removed.line is None:
        raise MergeProblem("One of them has no values yet")
    return kept, removed


def _flat(emitter: Emitter) -> list[FlatModeLine]:
    return flatten_emitter_snapshot(build_emitter_snapshot(emitter))


def _union_line(kept: dict, removed: dict, pri_type: PriType) -> dict:
    line = {k: kept.get(k) for k in ModeLineFields.model_fields}
    for lo, hi in _RANGES:
        los = [v for v in (kept.get(lo), removed.get(lo)) if v is not None]
        his = [v for v in (kept.get(hi), removed.get(hi)) if v is not None]
        line[lo] = min(los) if los else None
        line[hi] = max(his) if his else None
    for m in _MARGINS:
        values = [v for v in (kept.get(m), removed.get(m)) if v is not None]
        line[m] = max(values) if values else None
    for m in _MATCHING:
        line[m] = bool(kept.get(m)) or bool(removed.get(m))
    if pri_type == PriType.stagger:
        a = [round(float(v), 6) for v in kept.get("pri_stagger_values_us") or []]
        b = [round(float(v), 6) for v in removed.get("pri_stagger_values_us") or []]
        if a != b:
            raise MergeProblem(
                "Their stagger sequences differ — merging would have to pick one; edit them on the Emitter instead"
            )
    return line


def _validated(line: dict, pri_type: PriType) -> ModeLineFields:
    try:
        fields = ModeLineFields(**line)
        validate_pri_type_fields(pri_type, fields)
        require_manual_deltas(pri_type, fields)
    except (ValidationError, ValueError) as err:
        raise MergeProblem(f"The merged values aren't valid: {err}") from err
    return fields


def _spans(line: dict, pri_type: str) -> dict:
    """The ranges as the check compares them (with margins), for showing."""
    c = compared_line(line, True)
    out = {"rf": [c["rf_min_mhz"], c["rf_max_mhz"]], "pw": [c["pw_min_us"], c["pw_max_us"]]}
    if pri_type == "fixed":
        out["pri"] = [c["pri_min_us"], c["pri_max_us"]]
    if pri_type == "stagger":
        out["stagger"] = c.get("pri_stagger_values_us")
    return out


def _links(db: Session, mode_id) -> dict:
    return {
        "intercept_entries": db.query(InterceptEntryMode).filter(InterceptEntryMode.mode_id == mode_id).count(),
        "test_records": db.query(TestRecordMode).filter(TestRecordMode.mode_id == mode_id).count(),
        "test_record_lines": db.query(TestRecordLineMode).filter(TestRecordLineMode.mode_id == mode_id).count(),
        "test_lines": db.query(TestLine).filter(TestLine.expected_mode_id == mode_id).count(),
    }


def plan(db: Session, finding: AmbiguityFinding, keep: str) -> dict:
    """What merging would do — nothing is changed."""
    kept, removed = _modes(db, finding, keep)
    emitter = db.get(Emitter, kept.source.emitter_id)
    flat = {m.mode_id: m for m in _flat(emitter)}
    kept_flat, removed_flat = flat.get(str(kept.id)), flat.get(str(removed.id))
    if kept_flat is None or removed_flat is None:
        raise MergeProblem("One of them only has rejected Sources — accept one of its Sources first")
    merged = _union_line(kept_flat.line, removed_flat.line, kept.pri_type)
    _validated(merged, kept.pri_type)

    # Overlaps with the Emitter's other Modes, now and with the merged values.
    tolerance = {**DEFAULT_TOLERANCE, **(finding.run.tolerance_config or {}), "apply_margins": True}
    others = [m for mid, m in flat.items() if mid not in (str(kept.id), str(removed.id))]

    def severities(line: dict) -> dict[str, tuple[str, str]]:
        probe = FlatModeLine(**{**kept_flat.__dict__, "line": line})
        out = {}
        for f in compute_pairwise_findings([probe, *others], tolerance):
            if str(kept.id) in (f["mode_id_a"], f["mode_id_b"]):
                other = f["mode_id_b"] if f["mode_id_a"] == str(kept.id) else f["mode_id_a"]
                out[other] = f["combined_severity"]
        return out

    before, after = severities(kept_flat.line), severities(merged)
    names = {m.mode_id: m.mode_name for m in others}
    worse = [
        {"mode_id": mid, "mode_name": names.get(mid, "?"), "before": before.get(mid, "none"), "after": sev}
        for mid, sev in after.items()
        if SEVERITY_RANK[sev] > SEVERITY_RANK[before.get(mid, "none")]
    ]
    worse.sort(key=lambda w: (-SEVERITY_RANK[w["after"]], w["mode_name"]))
    return {
        "keep": keep,
        "kept": {"id": str(kept.id), "name": kept.name, "before": _spans(kept_flat.line, kept.pri_type.value),
                 "after": _spans(merged, kept.pri_type.value),
                 # The kept Mode takes on the removed one's Sources too.
                 "sources_after": list(dict.fromkeys([*kept.source_names, *removed.source_names]))},
        "removed": {"id": str(removed.id), "name": removed.name, "source_name": ", ".join(removed.source_names),
                    "spans": _spans(removed_flat.line, removed.pri_type.value)},
        "links_moved": _links(db, removed.id),
        "new_overlaps": worse,
        "emitter": {"id": str(emitter.id), "name": emitter.name, "checked_out_by_id":
                    str(emitter.checked_out_by_id) if emitter.checked_out_by_id else None},
    }


def _move_links(db: Session, kept_id, removed_id) -> None:
    """Point what referred to the removed Mode at the kept one, dropping any
    link the kept Mode already has to the same thing."""
    for link in db.query(InterceptEntryMode).filter(InterceptEntryMode.mode_id == removed_id).all():
        twin = db.query(InterceptEntryMode).filter_by(intercept_entry_id=link.intercept_entry_id, mode_id=kept_id).first()
        if twin:
            db.delete(link)
        else:
            link.mode_id = kept_id
    for link in db.query(TestRecordMode).filter(TestRecordMode.mode_id == removed_id).all():
        twin = (
            db.query(TestRecordMode)
            .filter_by(test_record_id=link.test_record_id, mode_id=kept_id, link_type=link.link_type)
            .first()
        )
        if twin:
            db.delete(link)
        else:
            link.mode_id = kept_id
    for link in db.query(TestRecordLineMode).filter(TestRecordLineMode.mode_id == removed_id).all():
        twin = db.query(TestRecordLineMode).filter_by(test_record_line_id=link.test_record_line_id, mode_id=kept_id).first()
        if twin:
            db.delete(link)
        else:
            link.mode_id = kept_id
    for line in db.query(TestLine).filter(TestLine.expected_mode_id == removed_id).all():
        line.expected_mode_id = kept_id
    db.flush()


def apply(db: Session, finding: AmbiguityFinding, keep: str, user) -> dict:
    """Merge: widen the kept Mode, move the links, delete the other. The
    caller has checked the Emitter is checked out by `user`, and commits."""
    preview = plan(db, finding, keep)
    kept, removed = _modes(db, finding, keep)
    emitter_id = kept.source.emitter_id
    flat = {m.mode_id: m for m in _flat(db.get(Emitter, emitter_id))}
    merged = _validated(_union_line(flat[str(kept.id)].line, flat[str(removed.id)].line, kept.pri_type), kept.pri_type)

    when = datetime.now(timezone.utc)
    note = (
        f"Merged with \"{removed.name}\" (sources \"{', '.join(removed.source_names)}\", EW group \"{removed.ew_group.name}\") "
        f"on {when:%Y-%m-%d} by {user.username}, from an ambiguity check — its ranges are included in this Mode's."
    )
    if removed.notes:
        note += f"\nIts notes: {removed.notes.strip()}"
    line_fields = merged.model_dump()
    changes = apply_and_diff(kept.line, line_fields)
    changes.update(apply_and_diff(kept, {"notes": f"{kept.notes.rstrip()}\n\n{note}" if kept.notes else note}))
    try:
        kept.line.dsl_text = render_mode_line(
            pri_type=kept.pri_type, **{k: v for k, v in line_fields.items() if k not in NON_DSL_LINE_FIELDS}
        )
    except DslSyntaxError:
        kept.line.dsl_text = None

    old_sources = kept.source_names
    add_mode_sources(kept, removed.sources)
    if kept.source_names != old_sources:
        changes["sources"] = {"old": sources_label(old_sources), "new": sources_label(kept.source_names)}

    _move_links(db, kept.id, removed.id)

    removed_snapshot = snapshot(removed, ["name", "pri_type", "notes", "source_id", "function_group_id"])
    removed_snapshot["source_ids"] = [str(sid) for sid in removed.source_ids]
    removed_snapshot["line"] = flat[str(removed.id)].line
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.mode.value,
        entity_id=kept.id,
        summary=f"Merged Mode '{removed.name}' into '{kept.name}'",
        changes=changes,
        emitter_id=emitter_id,
    )
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.mode.value,
        entity_id=removed.id,
        summary=f"Deleted Mode '{removed.name}' — merged into '{kept.name}'",
        changes=removed_snapshot,
        emitter_id=emitter_id,
    )
    finding.resolution = {
        "action": "merged",
        "kept_mode_id": str(kept.id),
        "kept_name": kept.name,
        "removed_mode_id": str(removed.id),
        "removed_name": removed.name,
        "by": user.username,
        "at": when.isoformat(),
        "links_moved": preview["links_moved"],
    }
    db.delete(removed)
    return finding.resolution
