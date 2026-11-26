"""A radar's operational modes (volume search, track…), each Emitter's own.
Its Modes are linked to the one they're transmitted in and take its
illumination time for the dwell planner. Edited like EW Groups: only by the
editor holding the Emitter, saved with its versions."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_emitter_checkout, require_role
from app.models.emitter import Emitter
from app.models.mode import Mode
from app.models.operational_mode import OperationalMode
from app.schemas.operational_mode import (
    OperationalModeCreate,
    OperationalModeOut,
    OperationalModeUpdate,
)
from app.services.audit_service import apply_and_diff, record_audit, snapshot

router = APIRouter(prefix="/emitters/{emitter_id}/operational-modes", tags=["operational-modes"])

_FIELDS = ["name", "description", "illumination_time_ms", "sort_order"]


def _emitter_or_404(db: Session, emitter_id: UUID) -> Emitter:
    emitter = db.get(Emitter, emitter_id)
    if emitter is None or emitter.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    return emitter


def _get_or_404(db: Session, emitter_id: UUID, operational_mode_id: UUID) -> OperationalMode:
    row = db.get(OperationalMode, operational_mode_id)
    if row is None or row.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Operational mode not found")
    return row


def _with_count(db: Session, row: OperationalMode) -> OperationalMode:
    row.modes_count = db.query(func.count(Mode.id)).filter(Mode.operational_mode_id == row.id).scalar() or 0
    return row


def _check_name(db: Session, emitter_id: UUID, name: str, own_id: UUID | None = None) -> str:
    name = name.strip()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "An operational mode needs a name")
    clash = db.query(OperationalMode.id).filter(OperationalMode.emitter_id == emitter_id, OperationalMode.name == name)
    if own_id is not None:
        clash = clash.filter(OperationalMode.id != own_id)
    if clash.first():
        raise HTTPException(status.HTTP_409_CONFLICT, f"This Emitter already has an operational mode called '{name}'")
    return name


@router.get("", response_model=list[OperationalModeOut])
def list_operational_modes(
    emitter_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[OperationalMode]:
    _emitter_or_404(db, emitter_id)
    counts = dict(
        db.query(Mode.operational_mode_id, func.count(Mode.id))
        .join(OperationalMode, Mode.operational_mode_id == OperationalMode.id)
        .filter(OperationalMode.emitter_id == emitter_id)
        .group_by(Mode.operational_mode_id)
        .all()
    )
    rows = (
        db.query(OperationalMode)
        .filter(OperationalMode.emitter_id == emitter_id)
        .order_by(OperationalMode.sort_order, OperationalMode.name)
        .all()
    )
    for row in rows:
        row.modes_count = counts.get(row.id, 0)
    return rows


@router.post(
    "", response_model=OperationalModeOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)]
)
def create_operational_mode(
    emitter_id: UUID,
    payload: OperationalModeCreate,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> OperationalMode:
    _emitter_or_404(db, emitter_id)
    data = payload.model_dump()
    data["name"] = _check_name(db, emitter_id, data["name"])
    row = OperationalMode(emitter_id=emitter_id, **data)
    db.add(row)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.operational_mode.value,
        entity_id=row.id,
        summary=f"Created operational mode '{row.name}'",
        changes=payload.model_dump(mode="json"),
        emitter_id=emitter_id,
    )
    db.commit()
    db.refresh(row)
    return _with_count(db, row)


@router.patch("/{operational_mode_id}", response_model=OperationalModeOut, dependencies=[Depends(verify_csrf)])
def update_operational_mode(
    emitter_id: UUID,
    operational_mode_id: UUID,
    payload: OperationalModeUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> OperationalMode:
    row = _get_or_404(db, emitter_id, operational_mode_id)
    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        if data["name"] is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "An operational mode needs a name")
        data["name"] = _check_name(db, emitter_id, data["name"], own_id=row.id)
    if data.get("sort_order", 0) is None:
        data.pop("sort_order")
    old_name = row.name
    changes = apply_and_diff(row, data)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.operational_mode.value,
        entity_id=row.id,
        summary=(
            f"Renamed operational mode '{old_name}' to '{row.name}'"
            if row.name != old_name
            else f"Updated operational mode '{row.name}'"
        ),
        changes=changes,
        emitter_id=emitter_id,
    )
    db.commit()
    db.refresh(row)
    return _with_count(db, row)


@router.delete("/{operational_mode_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_operational_mode(
    emitter_id: UUID,
    operational_mode_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> None:
    """Its Modes stay, linked to none (they then take the Emitter's illumination time)."""
    row = _get_or_404(db, emitter_id, operational_mode_id)
    linked = db.query(func.count(Mode.id)).filter(Mode.operational_mode_id == row.id).scalar() or 0
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.operational_mode.value,
        entity_id=row.id,
        summary=f"Deleted operational mode '{row.name}'" + (f" ({linked} Mode(s) unlinked)" if linked else ""),
        changes=snapshot(row, _FIELDS),
        emitter_id=emitter_id,
    )
    db.query(Mode).filter(Mode.operational_mode_id == row.id).update(
        {Mode.operational_mode_id: None}, synchronize_session=False
    )
    db.delete(row)
    db.commit()
