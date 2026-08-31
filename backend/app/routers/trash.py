from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_role
from app.schemas.trash import DeletedItemOut
from app.services.audit_service import record_audit
from app.services.trash_service import get_deleted_entity, list_deleted

router = APIRouter(prefix="/trash", tags=["trash"], dependencies=[Depends(require_role(Role.admin))])

_ENTITY_TYPE_LABELS = {"emitter": "Emitter", "platform": "Platform", "mdf": "MDF"}


@router.get("", response_model=list[DeletedItemOut])
def get_trash(db: Session = Depends(get_db)) -> list[DeletedItemOut]:
    return list_deleted(db)


@router.delete("/{entity_type}/{entity_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def purge_forever(
    entity_type: str,
    entity_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.admin)),
) -> None:
    label = _ENTITY_TYPE_LABELS.get(entity_type)
    if label is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown entity type")
    entity = get_deleted_entity(db, entity_type, entity_id)
    if entity is None or not entity.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{label} not found in trash")
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=getattr(AuditEntityType, entity_type).value,
        entity_id=entity.id,
        summary=f"Permanently deleted {label} '{entity.name}' from trash",
    )
    db.delete(entity)
    db.commit()
