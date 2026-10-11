from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.config import settings
from app.core.enums import AuditAction, AuditEntityType
from app.models.audit_log import AuditLog
from app.models.emitter import Emitter
from app.services.audit_service import record_audit


class AlreadyCheckedOutBySomeoneElse(Exception):
    def __init__(self, holder_id: UUID):
        self.holder_id = holder_id
        super().__init__(f"Checked out by {holder_id}")


class NotCheckedOutByUser(Exception):
    pass


def start_checkout(emitter: Emitter, user_id: UUID) -> None:
    """Claims the editing lock for `user_id`. Idempotent if they already hold
    it; raises if someone else does.
    """
    if emitter.checked_out_by_id is not None and emitter.checked_out_by_id != user_id:
        raise AlreadyCheckedOutBySomeoneElse(emitter.checked_out_by_id)
    emitter.checked_out_by_id = user_id
    emitter.checked_out_at = datetime.now(timezone.utc)


def assert_checked_out_by(emitter: Emitter, user_id: UUID) -> None:
    if emitter.checked_out_by_id != user_id:
        raise NotCheckedOutByUser


def release_checkout(emitter: Emitter) -> None:
    emitter.checked_out_by_id = None
    emitter.checked_out_at = None


def last_activity(db: Session, emitters: list[Emitter]) -> dict[UUID, datetime]:
    """When each held Emitter was last touched by its holder: their latest
    change to it since taking the lock, or when they took it."""
    held = [e for e in emitters if e.checked_out_by_id is not None]
    if not held:
        return {}
    latest = dict(
        db.query(AuditLog.emitter_id, func.max(AuditLog.created_at))
        .join(Emitter, Emitter.id == AuditLog.emitter_id)
        .filter(
            AuditLog.emitter_id.in_([e.id for e in held]),
            AuditLog.actor_id == Emitter.checked_out_by_id,
            and_(Emitter.checked_out_at.is_not(None), AuditLog.created_at >= Emitter.checked_out_at),
        )
        .group_by(AuditLog.emitter_id)
        .all()
    )
    out = {}
    for e in held:
        times = [t for t in (e.checked_out_at, latest.get(e.id)) if t is not None]
        out[e.id] = max(times) if times else datetime.now(timezone.utc)
    return out


def release_stale_checkouts(db: Session) -> int:
    """Release every edit lock untouched for CHECKOUT_RELEASE_DAYS (nothing is
    discarded), each with an Audit Log entry. Returns how many."""
    days = settings.checkout_release_days
    if days <= 0:
        return 0
    held = db.query(Emitter).filter(Emitter.checked_out_by_id.is_not(None), Emitter.is_deleted.is_(False)).all()
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    activity = last_activity(db, held)
    released = 0
    for e in held:
        if activity[e.id] < cutoff:
            holder_id = e.checked_out_by_id
            release_checkout(e)
            record_audit(
                db,
                actor_id=None,
                action=AuditAction.checkin,
                entity_type=AuditEntityType.emitter.value,
                entity_id=e.id,
                summary=f"Released the edit lock on Emitter '{e.name}' automatically — untouched for over {days} days",
                changes={"released_holder_id": str(holder_id)},
                emitter_id=e.id,
            )
            released += 1
    if released:
        db.commit()
    return released
