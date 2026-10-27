"""What a revert or a discard changed, in the Audit Log item by item: each
Mode, EW Group, Source and SIM Test Line it brought back, removed or changed
(old → new), and per Source how many Elements and sequences — so a trail
filtered to one kind (an Emitter's Modes, say) still tells what happened.
Compares the Emitter's snapshot before and after the reconcile."""

import uuid

from sqlalchemy.orm import Session

from app.core.enums import AuditAction, AuditEntityType
from app.services.audit_service import record_audit

# A Mode's line, as its own create and update entries name the fields.
_LINE_FIELDS = (
    "rf_min_mhz", "rf_max_mhz", "rf_delta", "rf_range_matching",
    "pri_min_us", "pri_max_us", "pri_delta", "jitter_min_us", "jitter_max_us",
    "pri_stagger_values_us", "frame_time_delta_us", "explicit_frame_time_us", "pri_range_matching",
    "pw_min_us", "pw_max_us", "pw_delta", "pw_range_matching", "type_data",
)  # fmt: skip
_GROUP_FIELDS = ("name", "scan_min", "scan_max", "scan_delta", "threat_priority", "ageout")
_SOURCE_FIELDS = ("name", "description", "source_date", "source_type", "rf_legacy_term", "pri_legacy_term")
_TEST_LINE_FIELDS = ("label", "expected_mode_name", "expected_parameters", "created_date")


def _modes(snapshot: dict) -> dict[str, dict]:
    out = {}
    for group in snapshot.get("ew_groups", []):
        for m in group.get("modes", []):
            line = m.get("line") or {}
            out[m["id"]] = {
                "name": m["name"],
                "pri_type": m["pri_type"],
                "ew_group": group["name"],
                "sources": m.get("source_names") or [m.get("source_name")],
                "notes": m.get("notes"),
                "confirmation_quality": m.get("confirmation_quality"),
                "confirmation_quantity": m.get("confirmation_quantity"),
                **{f: line.get(f) for f in _LINE_FIELDS},
            }
    return out


def _pick(rows: list[dict], fields: tuple[str, ...]) -> dict[str, dict]:
    return {r["id"]: {f: r.get(f) for f in fields} for r in rows}


def _set(values: dict) -> dict:
    """What a brought-back or removed item had — its empty fields left out."""
    return {k: v for k, v in values.items() if v is not None}


def _diff(old: dict, new: dict) -> dict:
    return {k: {"old": old.get(k), "new": new.get(k)} for k in new if old.get(k) != new.get(k)}


def _children(snapshot: dict, key: str) -> dict[str, dict[str, dict]]:
    """Per Source id: its Elements (or sequences) by id."""
    return {s["id"]: {c["id"]: c for c in s.get(key, [])} for s in snapshot.get("sources", [])}


def _counts(before: dict[str, dict], after: dict[str, dict]) -> tuple[int, int, int]:
    back = len(after.keys() - before.keys())
    gone = len(before.keys() - after.keys())
    changed = sum(1 for k in before.keys() & after.keys() if before[k] != after[k])
    return back, gone, changed


def _uuid(value: str | None) -> uuid.UUID | None:
    return uuid.UUID(value) if value else None


def record_reconcile(db: Session, *, actor_id, emitter_id, before: dict, after: dict, why: str) -> None:
    """`why` finishes each summary: "reverting to version 2"."""

    def log(action, entity_type, entity_id, summary, changes):
        record_audit(
            db,
            actor_id=actor_id,
            action=action,
            entity_type=entity_type.value,
            entity_id=_uuid(entity_id),
            summary=f"{summary} — {why}",
            changes=changes,
            emitter_id=emitter_id,
        )

    def items(kind: AuditEntityType, noun: str, old: dict[str, dict], new: dict[str, dict], label: str) -> None:
        for key in new.keys() - old.keys():
            log(AuditAction.create, kind, key, f"Brought back {noun} '{new[key][label]}'", _set(new[key]))
        for key in old.keys() - new.keys():
            log(AuditAction.delete, kind, key, f"Removed {noun} '{old[key][label]}'", _set(old[key]))
        for key in old.keys() & new.keys():
            changes = _diff(old[key], new[key])
            if changes:
                log(AuditAction.update, kind, key, f"Changed {noun} '{new[key][label]}' back", changes)

    items(AuditEntityType.ew_group, "EW Group", _pick(before.get("ew_groups", []), _GROUP_FIELDS),
          _pick(after.get("ew_groups", []), _GROUP_FIELDS), "name")  # fmt: skip
    items(AuditEntityType.source, "Source", _pick(before.get("sources", []), _SOURCE_FIELDS),
          _pick(after.get("sources", []), _SOURCE_FIELDS), "name")  # fmt: skip
    items(AuditEntityType.mode, "Mode", _modes(before), _modes(after), "name")
    items(AuditEntityType.test_line, "SIM Test Line", _pick(before.get("test_lines", []), _TEST_LINE_FIELDS),
          _pick(after.get("test_lines", []), _TEST_LINE_FIELDS), "label")  # fmt: skip

    # Elements and sequences: one entry per Source, counted — a revert can
    # touch hundreds of Elements.
    names = {s["id"]: s["name"] for s in [*before.get("sources", []), *after.get("sources", [])]}
    for key, kind, noun in (
        ("elements", AuditEntityType.mode_element, "Elements"),
        ("parameter_sequences", AuditEntityType.parameter_sequence, "sequences"),
    ):
        old_by_source, new_by_source = _children(before, key), _children(after, key)
        for source_id in sorted(old_by_source.keys() | new_by_source.keys(), key=lambda s: names.get(s, "")):
            back, gone, changed = _counts(old_by_source.get(source_id, {}), new_by_source.get(source_id, {}))
            parts = [f"{n} {word}" for n, word in ((back, "brought back"), (gone, "removed"), (changed, "changed")) if n]
            if parts:
                log(AuditAction.update, kind, None, f"{noun} of Source '{names.get(source_id, '?')}': {', '.join(parts)}",
                    {"source": names.get(source_id), "brought_back": back, "removed": gone, "changed": changed})  # fmt: skip
