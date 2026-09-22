from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_emitter_checkout, require_role
from app.models.emitter import Emitter
from app.models.ew_group import EwGroup
from app.models.mode import Mode
from app.models.test_line import TestLine
from app.schemas.test_line import TestLineImportRequest, TestLineOut, TestLineUpdate
from app.services.audit_service import apply_and_diff, record_audit

# Test Lines are part of the Emitter's own versioned definition (see
# snapshots.py::build_emitter_snapshot) — importing, editing or removing one
# requires holding the Emitter's checkout lock and only becomes permanent
# once committed, same as a Mode or Source.
router = APIRouter(prefix="/emitters/{emitter_id}/test-lines", tags=["test-lines"])

_EAGER_LOAD = joinedload(TestLine.expected_mode)


def _to_out(tl: TestLine) -> TestLineOut:
    out = TestLineOut.model_validate(tl)
    out.expected_mode_name = tl.expected_mode.name if tl.expected_mode else None
    return out


def _validate_mode_ids(db: Session, emitter_id: UUID, mode_ids: set[UUID]) -> None:
    if not mode_ids:
        return
    found_ids = {
        m.id
        for m in db.query(Mode.id)
        .join(EwGroup, Mode.ew_group_id == EwGroup.id)
        .filter(Mode.id.in_(mode_ids), EwGroup.emitter_id == emitter_id)
        .all()
    }
    missing = mode_ids - found_ids
    if missing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown mode id(s) for this Emitter: {missing}")


@router.get("", response_model=list[TestLineOut])
def list_test_lines(emitter_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> list[TestLineOut]:
    if db.get(Emitter, emitter_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    lines = (
        db.query(TestLine)
        .options(_EAGER_LOAD)
        .filter(TestLine.emitter_id == emitter_id)
        .order_by(TestLine.sort_order.asc(), TestLine.created_at.asc())
        .all()
    )
    return [_to_out(tl) for tl in lines]


@router.post("/import", response_model=list[TestLineOut], status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
def import_test_lines(
    emitter_id: UUID,
    payload: TestLineImportRequest,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> list[TestLineOut]:
    if db.get(Emitter, emitter_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    if not payload.lines:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "At least one line is required")

    mode_ids = {ln.expected_mode_id for ln in payload.lines if ln.expected_mode_id is not None}
    _validate_mode_ids(db, emitter_id, mode_ids)

    next_sort_order = (
        db.query(func.coalesce(func.max(TestLine.sort_order), -1)).filter(TestLine.emitter_id == emitter_id).scalar()
        + 1
    )
    created: list[TestLine] = []
    for i, ln in enumerate(payload.lines):
        row = TestLine(
            emitter_id=emitter_id,
            label=ln.label,
            expected_mode_id=ln.expected_mode_id,
            expected_parameters=ln.expected_parameters,
            import_batch_label=payload.batch_label,
            imported_by=user.id,
            sort_order=next_sort_order + i,
        )
        db.add(row)
        created.append(row)
    db.flush()

    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.test_line.value,
        entity_id=created[0].id,
        summary=f"Imported {len(created)} Test Line(s)" + (f" ({payload.batch_label})" if payload.batch_label else ""),
        changes=payload.model_dump(mode="json"),
        emitter_id=emitter_id,
    )
    db.commit()
    for row in created:
        db.refresh(row)
    ids = [row.id for row in created]
    lines = db.query(TestLine).options(_EAGER_LOAD).filter(TestLine.id.in_(ids)).all()
    by_id = {ln.id: ln for ln in lines}
    return [_to_out(by_id[i]) for i in ids]


@router.patch("/{test_line_id}", response_model=TestLineOut, dependencies=[Depends(verify_csrf)])
def update_test_line(
    emitter_id: UUID,
    test_line_id: UUID,
    payload: TestLineUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> TestLineOut:
    line = db.get(TestLine, test_line_id)
    if line is None or line.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Test line not found")
    updates = payload.model_dump(exclude_unset=True)
    if "expected_mode_id" in updates and updates["expected_mode_id"] is not None:
        _validate_mode_ids(db, emitter_id, {updates["expected_mode_id"]})
    changes = apply_and_diff(line, updates)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.test_line.value,
        entity_id=line.id,
        summary=f"Updated test line '{line.label}'",
        changes=changes,
        emitter_id=emitter_id,
    )
    db.commit()
    db.refresh(line)
    return _to_out(line)


@router.delete("/{test_line_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_test_line(
    emitter_id: UUID, test_line_id: UUID, db: Session = Depends(get_db), user=Depends(require_emitter_checkout())
) -> None:
    line = db.get(TestLine, test_line_id)
    if line is None or line.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Test line not found")
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.test_line.value,
        entity_id=line.id,
        summary=f"Deleted test line '{line.label}'",
        emitter_id=emitter_id,
    )
    db.delete(line)
    db.commit()
