import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import settings
from app.core.enums import AuditAction, AuditEntityType, TestScopeType
from app.models.ambiguity import AmbiguityRun
from app.models.cartesian_run import CartesianRun
from app.models.emitter import Emitter
from app.models.emitter_version import EmitterVersion
from app.models.mdf import Mdf
from app.models.mode import ModeGenerationBatch
from app.models.parameter_sequence import ParameterSequence
from app.models.source_note import SourceNote
from app.models.test_record import TestRecord
from app.models.platform import Platform
from app.schemas.trash import DeletedItemOut
from app.services.audit_service import record_audit

_TRASH_MODELS = {
    "emitter": Emitter,
    "platform": Platform,
    "mdf": Mdf,
}


def list_deleted(db: Session) -> list[DeletedItemOut]:
    """Every soft-deleted Emitter/Platform/MDF, combined into one list sorted
    by most-recently-deleted first — the Admin Trash page's data source.
    `deleted_at` is set whenever `is_deleted` is flipped True, so it's always
    present here even though the column is nullable at the DB level.
    """
    retention = timedelta(days=settings.trash_retention_days)
    items: list[DeletedItemOut] = []
    for entity_type, model in _TRASH_MODELS.items():
        rows = db.query(model).filter(model.is_deleted.is_(True)).all()
        for row in rows:
            if row.deleted_at is None:
                continue
            items.append(
                DeletedItemOut(
                    entity_type=entity_type,
                    id=row.id,
                    name=row.name,
                    deleted_at=row.deleted_at,
                    expires_at=row.deleted_at + retention,
                )
            )
    items.sort(key=lambda i: i.deleted_at, reverse=True)
    return items


def get_deleted_entity(db: Session, entity_type: str, entity_id):
    model = _TRASH_MODELS.get(entity_type)
    if model is None:
        return None
    return db.get(model, entity_id)


_TARGETS = [
    (Emitter, AuditEntityType.emitter, "Emitter"),
    (Platform, AuditEntityType.platform, "Platform"),
    (Mdf, AuditEntityType.mdf, "MDF"),
]


def purge(db: Session, row) -> None:
    """Deletes a trashed item for good, with its logged test runs and
    ambiguity checks (they name it by id, so they aren't deleted with it).
    An Emitter's Source notes, sequences, cartesian-run logs and generation
    batches aren't deleted with their Source or EW Group either (a revert can
    bring those back), so they go here — for every Source and EW Group it
    has, or had in a saved version."""
    scope = {Emitter: "emitter", Platform: "platform", Mdf: "mdf"}[type(row)]
    if scope in TestScopeType.__members__:
        for record in db.query(TestRecord).filter(TestRecord.scope_type == scope, TestRecord.scope_id == row.id):
            db.delete(record)
    db.query(AmbiguityRun).filter(AmbiguityRun.scope_type == scope, AmbiguityRun.scope_id == row.id).delete(
        synchronize_session=False
    )
    if isinstance(row, Emitter):
        source_ids = {s.id for s in row.sources}
        group_ids = {g.id for g in row.ew_groups}
        for (snap,) in db.query(EmitterVersion.snapshot).filter(EmitterVersion.emitter_id == row.id):
            source_ids |= {uuid.UUID(s["id"]) for s in snap.get("sources", [])}
            group_ids |= {uuid.UUID(g["id"]) for g in snap.get("ew_groups", [])}
        for model in (SourceNote, ParameterSequence, CartesianRun):
            db.query(model).filter(model.source_id.in_(source_ids)).delete(synchronize_session=False)
        db.query(ModeGenerationBatch).filter(
            or_(ModeGenerationBatch.source_id.in_(source_ids), ModeGenerationBatch.ew_group_id.in_(group_ids))
        ).delete(synchronize_session=False)
    db.flush()  # before the versions they pin go
    db.delete(row)


def purge_expired() -> int:
    """Hard-deletes everything past the retention window; returns how many."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.trash_retention_days)
    from app.database import SessionLocal

    db = SessionLocal()
    purged = 0
    try:
        for model, entity_type, label in _TARGETS:
            rows = (
                db.query(model)
                .filter(model.is_deleted.is_(True), model.deleted_at.isnot(None), model.deleted_at < cutoff)
                .all()
            )
            for row in rows:
                record_audit(
                    db,
                    actor_id=None,
                    action=AuditAction.delete,
                    entity_type=entity_type.value,
                    entity_id=row.id,
                    summary=f"Auto-purged {label} '{row.name}' after {settings.trash_retention_days}-day retention window",
                )
                purge(db, row)
                purged += 1
        db.commit()
    finally:
        db.close()
    return purged
