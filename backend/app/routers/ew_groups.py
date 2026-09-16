from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_emitter_checkout, require_role
from app.models.emitter import Emitter
from app.models.ew_group import EwGroup
from app.schemas.ew_group import EwGroupCreate, EwGroupOut, EwGroupUpdate
from app.services.audit_service import apply_and_diff, record_audit

router = APIRouter(prefix="/emitters/{emitter_id}/ew-groups", tags=["ew-groups"])


def _get_emitter_or_404(db: Session, emitter_id: UUID) -> Emitter:
    emitter = db.get(Emitter, emitter_id)
    if emitter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    return emitter


@router.get("", response_model=list[EwGroupOut])
def list_ew_groups(
    emitter_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[EwGroupOut]:
    _get_emitter_or_404(db, emitter_id)
    
    # We use a subquery to count modes for each EW Group to avoid N+1 issues
    # and to populate the modes_count field in EwGroupOut
    from app.models.mode import Mode
    
    query = (
        db.query(EwGroup, func.count(Mode.id).label("modes_count"))
        .outerjoin(Mode, Mode.ew_group_id == EwGroup.id)
        .filter(EwGroup.emitter_id == emitter_id)
        .group_by(EwGroup.id)
        .order_by(EwGroup.sort_order)
    )
    
    results = query.all()
    
    # Convert the (EwGroup, count) tuples into EwGroupOut-compatible objects
    output = []
    for ew_group, modes_count in results:
        # We can't easily mutate the SQLAlchemy object to add modes_count without it being in the model,
        # but since EwGroupOut is a Pydantic model and we use from_attributes=True,
        # we can manually construct the dict or use a workaround.
        # A simpler way is to attach it to the object temporarily for Pydantic to pick it up.
        ew_group.modes_count = modes_count
        output.append(ew_group)
    
    return output


@router.post(
    "", response_model=EwGroupOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)]
)
def create_ew_group(
    emitter_id: UUID,
    payload: EwGroupCreate,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> EwGroup:
    from app.models.mode import Mode
    _get_emitter_or_404(db, emitter_id)
    ew_group = EwGroup(emitter_id=emitter_id, **payload.model_dump())
    db.add(ew_group)
    db.flush()
    
    modes_count = db.query(func.count(Mode.id)).filter(Mode.ew_group_id == ew_group.id).scalar() or 0
    ew_group.modes_count = modes_count

    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.ew_group.value,
        entity_id=ew_group.id,
        summary=f"Created EW Group '{ew_group.name}'",
        changes=payload.model_dump(mode="json"),
        emitter_id=emitter_id,
    )
    db.commit()
    db.refresh(ew_group)
    return ew_group


@router.patch("/{ew_group_id}", response_model=EwGroupOut, dependencies=[Depends(verify_csrf)])
def update_ew_group(
    emitter_id: UUID,
    ew_group_id: UUID,
    payload: EwGroupUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> EwGroup:
    from app.models.mode import Mode
    ew_group = db.get(EwGroup, ew_group_id)
    if ew_group is None or ew_group.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "EW Group not found")
    changes = apply_and_diff(ew_group, payload.model_dump(exclude_unset=True))
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.ew_group.value,
        entity_id=ew_group.id,
        summary=f"Updated EW Group '{ew_group.name}'",
        changes=changes,
        emitter_id=emitter_id,
    )
    db.commit()
    db.refresh(ew_group)
    
    modes_count = db.query(func.count(Mode.id)).filter(Mode.ew_group_id == ew_group.id).scalar() or 0
    ew_group.modes_count = modes_count
    
    return ew_group


@router.delete("/{ew_group_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_ew_group(
    emitter_id: UUID,
    ew_group_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> None:
    ew_group = db.get(EwGroup, ew_group_id)
    if ew_group is None or ew_group.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "EW Group not found")
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.ew_group.value,
        entity_id=ew_group.id,
        summary=f"Deleted EW Group '{ew_group.name}'",
        emitter_id=emitter_id,
    )
    db.delete(ew_group)
    db.commit()
