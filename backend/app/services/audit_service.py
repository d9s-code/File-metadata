import uuid

from sqlalchemy.orm import Session

from app.core.enums import AuditAction
from app.models.audit_log import AuditLog


def record_audit(
    db: Session,
    *,
    actor_id: uuid.UUID | None,
    action: AuditAction,
    entity_type: str,
    entity_id: uuid.UUID | None,
    summary: str,
    changes: dict | None = None,
) -> None:
    """Stages an audit log row on `db` — added to the same transaction as the
    mutation it's describing, so it commits (or rolls back) atomically with it.
    Call this right before the caller's own `db.commit()`.
    """
    db.add(
        AuditLog(
            actor_id=actor_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            summary=summary,
            changes=changes,
        )
    )
