from datetime import timedelta

from sqlalchemy.orm import Session

from app.config import settings
from app.models.emitter import Emitter
from app.models.mdf import Mdf
from app.models.platform import Platform
from app.schemas.trash import DeletedItemOut

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
