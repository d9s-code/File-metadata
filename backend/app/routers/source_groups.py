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

router = APIRouter(prefix="/source-groups", tags=["source-groups"])


def _get_source_group_or_404(db: Session, source_group_id: UUID) -> SourceGroup:
    group = db.get(SourceGroup, source_group_id)
    if group is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source Group not found")
    return group


@router.get("", response_model=list[SourceGroupOut])
def list_source_groups(db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> list[SourceGroup]:
    return db.query(SourceGroup).order_by(SourceGroup.name).all()


@router.post("", response_model=SourceGroupOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
def create_source_group(
    payload: SourceGroupCreate, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> SourceGroup:
    group = SourceGroup(**payload.model_dump())
    db.add(group)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.source_group.value,
        entity_id=group.id,
        summary=f"Created Source Group '{group.name}'",
        changes=payload.model_dump(mode="json"),
    )
    db.commit()
    db.refresh(group)
    return group


@router.patch("/{source_group_id}", response_model=SourceGroupOut, dependencies=[Depends(verify_csrf)])
def update_source_group(
    source_group_id: UUID,
    payload: SourceGroupUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> SourceGroup:
    group = _get_source_group_or_404(db, source_group_id)
    changes = apply_and_diff(group, payload.model_dump(exclude_unset=True))
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.source_group.value,
        entity_id=group.id,
        summary=f"Updated Source Group '{group.name}'",
        changes=changes,
    )
    db.commit()
    db.refresh(group)
    return group


@router.delete("/{source_group_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_source_group(
    source_group_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> None:
    # No "still has Sources" block, unlike Source-vs-Modes — a Source Group is
    # a soft label; deleting it SET NULLs any Sources that referenced it
    # rather than orphaning or blocking on them (see Source.group_id's FK).
    group = _get_source_group_or_404(db, source_group_id)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.source_group.value,
        entity_id=group.id,
        summary=f"Deleted Source Group '{group.name}'",
    )
    db.delete(group)
    db.commit()
