import enum
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.core.enums import AuditAction
from app.models.audit_log import AuditLog


def _json_safe(value: Any) -> Any:
    if isinstance(value, enum.Enum):
        return value.value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    return value


def apply_and_diff(entity: Any, updates: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Applies `updates` (field name -> new value) onto `entity` via setattr,
    and returns a JSON-safe {field: {"old": ..., "new": ...}} diff covering
    only the fields whose value actually changed.

    This is the shape the Audit Log UI renders as a human-readable red/green
    diff — call this from update endpoints instead of setattr-looping and
    dumping the raw request payload as `changes`, which only ever showed the
    new values with no "changed from" context.
    """
    changes: dict[str, dict[str, Any]] = {}
    for field, new_value in updates.items():
        old_safe = _json_safe(getattr(entity, field))
        new_safe = _json_safe(new_value)
        if old_safe != new_safe:
            changes[field] = {"old": old_safe, "new": new_safe}
        setattr(entity, field, new_value)
    return changes


def snapshot(entity: Any, fields: list[str]) -> dict[str, Any]:
    """A JSON-safe snapshot of `entity`'s current field values, for a delete
    endpoint's `changes` — there's no "new" value to diff against on a
    delete, only a record of what's being removed, so this renders the same
    way a create's payload does (new-value-only, no "old" side; see
    ChangesToggle/formatChanges on the frontend). Without this, a delete's
    audit entry names only the entity's type/id, not what it actually
    contained — the one thing you'd want to recover after deleting the
    wrong thing.
    """
    return {field: _json_safe(getattr(entity, field)) for field in fields}


def record_audit(
    db: Session,
    *,
    actor_id: uuid.UUID | None,
    action: AuditAction,
    entity_type: str,
    entity_id: uuid.UUID | None,
    summary: str,
    changes: dict | None = None,
    emitter_id: uuid.UUID | None = None,
) -> None:
    """Stages an audit log row on `db` — added to the same transaction as the
    mutation it's describing, so it commits (or rolls back) atomically with it.
    Call this right before the caller's own `db.commit()`.

    `emitter_id` is the owning Emitter for entries whose entity lives under
    one (Emitter itself, or its EW Groups/Sources/Modes/elements/generation
    batches/import batches/emitter-scoped test records) — pass it whenever
    the caller can cheaply derive it, so an Emitter's Audit tab can roll up
    everything that happened to it, including entities later deleted.
    """
    db.add(
        AuditLog(
            actor_id=actor_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            summary=summary,
            changes=changes,
            emitter_id=emitter_id,
        )
    )
