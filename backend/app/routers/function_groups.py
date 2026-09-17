from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_emitter_checkout, require_role
from app.models.emitter import Emitter
from app.models.function_group import FunctionGroup
from app.models.mode import Mode
from app.schemas.function_group import FunctionGroupCreate, FunctionGroupOut, FunctionGroupUpdate
from app.services.audit_service import apply_and_diff, record_audit, snapshot

router = APIRouter(prefix="/emitters/{emitter_id}/function-groups", tags=["function-groups"])


def _get_emitter_or_404(db: Session, emitter_id: UUID) -> Emitter:
    emitter = db.get(Emitter, emitter_id)
    if emitter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    return emitter


@router.get("", response_model=list[FunctionGroupOut])
def list_function_groups(
    emitter_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[FunctionGroupOut]:
    _get_emitter_or_404(db, emitter_id)

    query = (
        db.query(FunctionGroup, func.count(Mode.id).label("modes_count"))
        .outerjoin(Mode, Mode.function_group_id == FunctionGroup.id)
        .filter(FunctionGroup.emitter_id == emitter_id)
        .group_by(FunctionGroup.id)
        .order_by(FunctionGroup.sort_order)
    )

    output = []
    for group, modes_count in query.all():
        group.modes_count = modes_count
        output.append(group)
    return output


@router.post(
    "", response_model=FunctionGroupOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)]
)
def create_function_group(
    emitter_id: UUID,
    payload: FunctionGroupCreate,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> FunctionGroup:
    _get_emitter_or_404(db, emitter_id)
    group = FunctionGroup(emitter_id=emitter_id, **payload.model_dump())
    db.add(group)
    db.flush()
    group.modes_count = 0

    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.function_group.value,
        entity_id=group.id,
        summary=f"Created Function Group '{group.name}'",
        changes=payload.model_dump(mode="json"),
        emitter_id=emitter_id,
    )
    db.commit()
    db.refresh(group)
    return group


@router.patch("/{function_group_id}", response_model=FunctionGroupOut, dependencies=[Depends(verify_csrf)])
def update_function_group(
    emitter_id: UUID,
    function_group_id: UUID,
    payload: FunctionGroupUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> FunctionGroup:
    group = db.get(FunctionGroup, function_group_id)
    if group is None or group.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Function Group not found")
    changes = apply_and_diff(group, payload.model_dump(exclude_unset=True))
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.function_group.value,
        entity_id=group.id,
        summary=f"Updated Function Group '{group.name}'",
        changes=changes,
        emitter_id=emitter_id,
    )
    db.commit()
    db.refresh(group)

    modes_count = db.query(func.count(Mode.id)).filter(Mode.function_group_id == group.id).scalar() or 0
    group.modes_count = modes_count
    return group


@router.delete("/{function_group_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_function_group(
    emitter_id: UUID,
    function_group_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> None:
    group = db.get(FunctionGroup, function_group_id)
    if group is None or group.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Function Group not found")
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.function_group.value,
        entity_id=group.id,
        summary=f"Deleted Function Group '{group.name}'",
        changes=snapshot(group, ["name", "sort_order"]),
        emitter_id=emitter_id,
    )
    db.delete(group)
    db.commit()
