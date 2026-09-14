from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_role
from app.models.source_group import SourceGroup
from app.schemas.source_group import SourceGroupCreate, SourceGroupOut, SourceGroupUpdate
from app.services.audit_service import apply_and_diff, record_audit

router = APIRouter(prefix="/source-groups", tags=["source_groups"])


def _get_source_group_or_404(db: Session, group_id: UUID) -> SourceGroup:
    group = db.get(SourceGroup, group_id)
    if group is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source group not found")
    return group


@router.get("/", response_model=list[SourceGroupOut])
def list_source_groups(db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> list[SourceGroup]:
    """Lists all source groups."""
    return db.query(SourceGroup).order_by(SourceGroup.name).all()


@router.post("/", response_model=SourceGroupOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
def create_source_group(
    source_group: SourceGroupCreate, db: Session = Depends(get_db), user=Depends(require_role(Role.admin))
) -> SourceGroup:
    """Creates a new source group."""
    db_group = SourceGroup(**source_group.model_dump())
    db.add(db_group)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.source_group.value,
        entity_id=db_group.id,
        summary=f"Created Source Group '{db_group.name}'",
        changes=source_group.model_dump(mode="json"),
    )
    db.commit()
    db.refresh(db_group)
    return db_group


@router.get("/{group_id}", response_model=SourceGroupOut)
def get_source_group(
    group_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> SourceGroup:
    """Gets a specific source group by ID."""
    return _get_source_group_or_404(db, group_id)


@router.patch("/{group_id}", response_model=SourceGroupOut, dependencies=[Depends(verify_csrf)])
def update_source_group(
    group_id: UUID,
    source_group_update: SourceGroupUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.admin)),
) -> SourceGroup:
    """Updates an existing source group."""
    db_group = _get_source_group_or_404(db, group_id)
    changes = apply_and_diff(db_group, source_group_update.model_dump(exclude_unset=True))
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.source_group.value,
        entity_id=db_group.id,
        summary=f"Updated Source Group '{db_group.name}'",
        changes=changes,
    )
    db.commit()
    db.refresh(db_group)
    return db_group


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_source_group(
    group_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.admin))
) -> None:
    """Deletes a source group. Sources in this group have their group_id set to NULL."""
    db_group = _get_source_group_or_404(db, group_id)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.source_group.value,
        entity_id=db_group.id,
        summary=f"Deleted Source Group '{db_group.name}'",
    )
    db.delete(db_group)
    db.commit()
