"""A radar's operational modes (volume search, track…), each Emitter's own,
in a tree: TRACK holds Track 1, 2, 3, and those can hold more. Its Modes are
linked to the one they're transmitted in and take its illumination time (or
the nearest one above it that has one) for the dwell planner; values set on
an operational mode are set on every Mode under it. Edited like EW Groups:
only by the editor holding the Emitter, saved with its versions."""

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
from app.schemas.mode import BatchModeFieldEdit, ModeBatchEditResult
from app.schemas.operational_mode import (
    OperationalModeCreate,
    OperationalModeOut,
    OperationalModeSetValues,
    OperationalModeUpdate,
)
from app.services.audit_service import apply_and_diff, record_audit, snapshot
from app.services.mode_batch_service import apply_batch_edit, plan_batch_edit

router = APIRouter(prefix="/emitters/{emitter_id}/operational-modes", tags=["operational-modes"])

_FIELDS = ["name", "parent_id", "description", "illumination_time_ms", "sort_order"]


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


def _check_name(db: Session, emitter_id: UUID, name: str, parent_id: UUID | None, own_id: UUID | None = None) -> str:
    """Not blank, and not a sibling's name (the same name under another parent is fine)."""
    name = name.strip()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "An operational mode needs a name")
    clash = db.query(OperationalMode.id).filter(
        OperationalMode.emitter_id == emitter_id,
        OperationalMode.name == name,
        OperationalMode.parent_id.is_(None) if parent_id is None else OperationalMode.parent_id == parent_id,
    )
    if own_id is not None:
        clash = clash.filter(OperationalMode.id != own_id)
    if clash.first():
        where = "at the top" if parent_id is None else f"under '{db.get(OperationalMode, parent_id).name}'"
        raise HTTPException(status.HTTP_409_CONFLICT, f"There's already an operational mode called '{name}' {where}")
    return name


def _below(db: Session, emitter_id: UUID, root_id: UUID) -> list[UUID]:
    """It and every operational mode under it, at any depth."""
    children: dict[UUID | None, list[UUID]] = {}
    for row_id, parent_id in db.query(OperationalMode.id, OperationalMode.parent_id).filter(
        OperationalMode.emitter_id == emitter_id
    ):
        children.setdefault(parent_id, []).append(row_id)
    out, todo = [], [root_id]
    while todo:
        current = todo.pop()
        out.append(current)
        todo.extend(children.get(current, []))
    return out


def _check_parent(db: Session, emitter_id: UUID, parent_id: UUID | None, own_id: UUID | None = None) -> None:
    """One of this Emitter's, and — when moving one — not it or anything under it."""
    if parent_id is None:
        return
    parent = db.get(OperationalMode, parent_id)
    if parent is None or parent.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That operational mode to put it under isn't one of this Emitter's")
    if own_id is not None and parent_id in _below(db, emitter_id, own_id):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "It can't go under itself or one of its own")


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
    _check_parent(db, emitter_id, data["parent_id"])
    data["name"] = _check_name(db, emitter_id, data["name"], data["parent_id"])
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
    parent_id = data.get("parent_id", row.parent_id)
    if "parent_id" in data:
        _check_parent(db, emitter_id, parent_id, own_id=row.id)
    if "name" in data and data["name"] is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "An operational mode needs a name")
    if "name" in data or "parent_id" in data:
        data["name"] = _check_name(db, emitter_id, data.get("name", row.name), parent_id, own_id=row.id)
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
    """What was under it — its Modes and the operational modes below it —
    moves up to its parent (to none / the top when it has none)."""
    row = _get_or_404(db, emitter_id, operational_mode_id)
    linked = db.query(func.count(Mode.id)).filter(Mode.operational_mode_id == row.id).scalar() or 0
    children = db.query(OperationalMode).filter(OperationalMode.parent_id == row.id).all()
    for child in children:
        # A child whose name its new siblings already have can't move up.
        _check_name(db, emitter_id, child.name, row.parent_id, own_id=child.id)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.operational_mode.value,
        entity_id=row.id,
        summary=f"Deleted operational mode '{row.name}'"
        + (f" ({linked} Mode(s) and {len(children)} operational mode(s) moved up)" if linked or children else ""),
        changes=snapshot(row, _FIELDS),
        emitter_id=emitter_id,
    )
    db.query(Mode).filter(Mode.operational_mode_id == row.id).update(
        {Mode.operational_mode_id: row.parent_id}, synchronize_session=False
    )
    for child in children:
        child.parent_id = row.parent_id
    db.flush()
    db.delete(row)
    db.commit()


@router.post(
    "/{operational_mode_id}/set-values", response_model=ModeBatchEditResult, dependencies=[Depends(verify_csrf)]
)
def set_values_below(
    emitter_id: UUID,
    operational_mode_id: UUID,
    payload: OperationalModeSetValues,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> ModeBatchEditResult:
    """Sets these values on every Mode under it — it and the operational
    modes below it — all or nothing: one Mode the values don't suit (a
    stagger given a PRI range, a min above its max) refuses them all, each
    listed. Audited on each Mode."""
    row = _get_or_404(db, emitter_id, operational_mode_id)
    values = payload.given()
    if not values:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Nothing to set")
    below = _below(db, emitter_id, row.id)
    mode_ids = [m for (m,) in db.query(Mode.id).filter(Mode.operational_mode_id.in_(below))]
    if not mode_ids:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"No Modes are under '{row.name}' yet")
    planned, errors = plan_batch_edit(
        db, emitter_id=emitter_id, mode_ids=mode_ids, fields=BatchModeFieldEdit(), line_values=values
    )
    if errors:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=[e.model_dump(mode="json") for e in errors])
    updated = apply_batch_edit(
        db,
        planned=planned,
        derived_from_test_record_ids=[],
        actor_id=user.id,
        emitter_id=emitter_id,
        shift_reason=f"set on operational mode '{row.name}'",
    )
    db.commit()
    return ModeBatchEditResult(updated_mode_ids=updated, count=len(updated))
