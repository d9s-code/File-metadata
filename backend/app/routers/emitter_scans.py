"""An Emitter's scans: how its antenna moves, with what's needed to work out
its illumination time and revisit (worked out in the app). Operational modes
and Modes point to one. Edited like operational modes: only by the editor
holding the Emitter, saved with its versions. Not exported."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_emitter_checkout, require_role
from app.models.emitter import Emitter
from app.models.emitter_scan import EmitterScan
from app.models.mode import Mode
from app.models.operational_mode import OperationalMode
from app.schemas.emitter_scan import (
    SCAN_PATTERNS,
    EmitterScanCreate,
    EmitterScanOut,
    EmitterScanUpdate,
    check_params,
)
from app.services.audit_service import apply_and_diff, record_audit, snapshot

router = APIRouter(prefix="/emitters/{emitter_id}/scans", tags=["scans"])

_FIELDS = ["name", "pattern", "params", "beam_az_deg", "beam_el_deg", "illumination_ms", "description", "sort_order"]


def _emitter_or_404(db: Session, emitter_id: UUID) -> Emitter:
    emitter = db.get(Emitter, emitter_id)
    if emitter is None or emitter.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    return emitter


def _get_or_404(db: Session, emitter_id: UUID, scan_id: UUID) -> EmitterScan:
    row = db.get(EmitterScan, scan_id)
    if row is None or row.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Scan not found")
    return row


def _check_name(db: Session, emitter_id: UUID, name: str, own_id: UUID | None = None) -> str:
    name = name.strip()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A scan needs a name")
    clash = db.query(EmitterScan.id).filter(EmitterScan.emitter_id == emitter_id, EmitterScan.name == name)
    if own_id is not None:
        clash = clash.filter(EmitterScan.id != own_id)
    if clash.first():
        raise HTTPException(status.HTTP_409_CONFLICT, f"This Emitter already has a scan called '{name}'")
    return name


def _counts(db: Session, rows: list[EmitterScan]) -> list[EmitterScan]:
    ids = [r.id for r in rows]
    ops = dict(
        db.query(OperationalMode.scan_id, func.count(OperationalMode.id))
        .filter(OperationalMode.scan_id.in_(ids))
        .group_by(OperationalMode.scan_id)
        .all()
    ) if ids else {}
    modes = dict(
        db.query(Mode.scan_id, func.count(Mode.id)).filter(Mode.scan_id.in_(ids)).group_by(Mode.scan_id).all()
    ) if ids else {}
    for r in rows:
        r.operational_modes_count = ops.get(r.id, 0)
        r.modes_count = modes.get(r.id, 0)
    return rows


@router.get("", response_model=list[EmitterScanOut])
def list_scans(emitter_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> list[EmitterScan]:
    _emitter_or_404(db, emitter_id)
    rows = (
        db.query(EmitterScan)
        .filter(EmitterScan.emitter_id == emitter_id)
        .order_by(EmitterScan.sort_order, EmitterScan.name)
        .all()
    )
    return _counts(db, rows)


@router.post("", response_model=EmitterScanOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
def create_scan(
    emitter_id: UUID,
    payload: EmitterScanCreate,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> EmitterScan:
    _emitter_or_404(db, emitter_id)
    data = payload.model_dump()
    data["name"] = _check_name(db, emitter_id, data["name"])
    if data["sort_order"] is None:
        top = db.query(func.max(EmitterScan.sort_order)).filter(EmitterScan.emitter_id == emitter_id).scalar()
        data["sort_order"] = 0 if top is None else top + 1
    row = EmitterScan(emitter_id=emitter_id, **data)
    db.add(row)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.scan.value,
        entity_id=row.id,
        summary=f"Created scan '{row.name}'",
        changes=payload.model_dump(mode="json"),
        emitter_id=emitter_id,
    )
    db.commit()
    db.refresh(row)
    return _counts(db, [row])[0]


@router.patch("/{scan_id}", response_model=EmitterScanOut, dependencies=[Depends(verify_csrf)])
def update_scan(
    emitter_id: UUID,
    scan_id: UUID,
    payload: EmitterScanUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> EmitterScan:
    row = _get_or_404(db, emitter_id, scan_id)
    data = payload.model_dump(exclude_unset=True)
    for key in ("name", "pattern", "sort_order"):
        if key in data and data[key] is None:
            data.pop(key)
    if "name" in data:
        data["name"] = _check_name(db, emitter_id, data["name"], own_id=row.id)
    if "pattern" in data or "params" in data:
        pattern = data.get("pattern", row.pattern)
        params = data.get("params", row.params)
        if "pattern" in data and data["pattern"] != row.pattern and "params" not in data:
            # Another pattern: only the values it takes too are kept.
            keep = set(SCAN_PATTERNS[pattern]) | {f"{k}_delta" for k in SCAN_PATTERNS[pattern]}
            params = {k: v for k, v in (params or {}).items() if k in keep}
        try:
            data["params"] = check_params(pattern, params)
        except ValueError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc))
    old_name = row.name
    changes = apply_and_diff(row, data)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.scan.value,
        entity_id=row.id,
        summary=f"Renamed scan '{old_name}' to '{row.name}'" if row.name != old_name else f"Updated scan '{row.name}'",
        changes=changes,
        emitter_id=emitter_id,
    )
    db.commit()
    db.refresh(row)
    return _counts(db, [row])[0]


@router.delete("/{scan_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_scan(
    emitter_id: UUID,
    scan_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> None:
    """What used it no longer has a scan of its own (an operational mode's
    Modes then take the one above it's)."""
    row = _counts(db, [_get_or_404(db, emitter_id, scan_id)])[0]
    used = row.operational_modes_count + row.modes_count
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.scan.value,
        entity_id=row.id,
        summary=f"Deleted scan '{row.name}'" + (f" (used by {used})" if used else ""),
        changes=snapshot(row, _FIELDS),
        emitter_id=emitter_id,
    )
    db.query(OperationalMode).filter(OperationalMode.scan_id == row.id).update(
        {OperationalMode.scan_id: None}, synchronize_session=False
    )
    db.query(Mode).filter(Mode.scan_id == row.id).update({Mode.scan_id: None}, synchronize_session=False)
    db.flush()
    db.delete(row)
    db.commit()

