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
from app.models.test_record import TestRecordLine
from app.schemas.test_line import (
    TestLineCreate,
    TestLineImportRequest,
    TestLineOut,
    TestLineSyncChange,
    TestLineSyncMissing,
    TestLineSyncOut,
    TestLineSyncRequest,
    TestLineUpdate,
)
from app.services.audit_service import apply_and_diff, record_audit
from app.services.test_line_status_service import latest_line_outcomes

# Test Lines are part of the Emitter's own versioned definition (see
# snapshots.py::build_emitter_snapshot) — importing, editing or removing one
# requires holding the Emitter's checkout lock and only becomes permanent
# once committed, same as a Mode or Source.
router = APIRouter(prefix="/emitters/{emitter_id}/test-lines", tags=["test-lines"])

_EAGER_LOAD = joinedload(TestLine.expected_mode)


def _to_out(tl: TestLine, status_row: tuple | None = None) -> TestLineOut:
    out = TestLineOut.model_validate(tl)
    out.expected_mode_name = tl.expected_mode.name if tl.expected_mode else None
    if status_row is not None:
        out.last_tested_at, out.last_test_result, out.last_test_record_id = status_row
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
    statuses = latest_line_outcomes(db, [tl.id for tl in lines])
    return [_to_out(tl, statuses.get(tl.id)) for tl in lines]


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
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "At least one line is required")

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
            created_date=payload.created_date,
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
        summary=f"Imported {len(created)} SIM Test Line(s)" + (f" ({payload.batch_label})" if payload.batch_label else ""),
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


def _label_key(label: str) -> str:
    return " ".join(label.split()).casefold()


@router.post("/sync", response_model=TestLineSyncOut, dependencies=[Depends(verify_csrf)])
def sync_test_lines(
    emitter_id: UUID,
    payload: TestLineSyncRequest,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> TestLineSyncOut:
    """Update the Emitter's SIM Test Lines from a revised table. Each row is
    matched to an existing line by label (ignoring case and extra spaces): a
    matched line keeps its id and test history and takes the row's detail,
    the table's created date and batch; a row with no match is added; lines
    not in the table are kept, or deleted when asked. The lines end up in the
    table's order. With apply=false nothing is written — the result says what
    would change."""
    if db.get(Emitter, emitter_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    rows = [ln for ln in payload.lines if ln.label.strip()]
    if not rows:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "At least one line is required")
    seen: dict[str, str] = {}
    for ln in rows:
        key = _label_key(ln.label)
        if key in seen:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"'{ln.label.strip()}' is in the table twice — each line needs its own label to be matched",
            )
        seen[key] = ln.label
    _validate_mode_ids(db, emitter_id, {ln.expected_mode_id for ln in rows if ln.expected_mode_id is not None})

    existing = (
        db.query(TestLine)
        .filter(TestLine.emitter_id == emitter_id)
        .order_by(TestLine.sort_order.asc(), TestLine.created_at.asc())
        .all()
    )
    # Two existing lines with the same label: the first is the one matched.
    by_key: dict[str, TestLine] = {}
    for tl in existing:
        by_key.setdefault(_label_key(tl.label), tl)

    added: list[str] = []
    updated: list[TestLineSyncChange] = []
    unchanged: list[str] = []
    plan: list[tuple[TestLine | None, TestLineCreate, dict]] = []
    matched_ids = set()
    for ln in rows:
        line = by_key.get(_label_key(ln.label))
        label = ln.label.strip()
        if line is None or line.id in matched_ids:
            added.append(label)
            plan.append((None, ln, {}))
            continue
        matched_ids.add(line.id)
        values = {"label": label, "created_date": payload.created_date}
        # A table of labels only leaves the detail as it is.
        if ln.expected_parameters:
            values["expected_parameters"] = ln.expected_parameters
        if payload.batch_label:
            values["import_batch_label"] = payload.batch_label
        if ln.expected_mode_id is not None:
            values["expected_mode_id"] = ln.expected_mode_id
        names = {
            "label": "label",
            "created_date": "created date",
            "expected_parameters": "detail",
            "import_batch_label": "batch",
            "expected_mode_id": "expected Mode",
        }
        changes = [names[k] for k, v in values.items() if getattr(line, k) != v]
        if changes:
            updated.append(TestLineSyncChange(id=line.id, label=label, changes=changes))
        else:
            unchanged.append(label)
        plan.append((line, ln, values))

    missing_lines = [tl for tl in existing if tl.id not in matched_ids]
    result_counts = dict(
        db.query(TestRecordLine.test_line_id, func.count(TestRecordLine.id))
        .filter(TestRecordLine.test_line_id.in_([tl.id for tl in missing_lines]))
        .group_by(TestRecordLine.test_line_id)
        .all()
    ) if missing_lines else {}
    missing = [TestLineSyncMissing(id=tl.id, label=tl.label, results=result_counts.get(tl.id, 0)) for tl in missing_lines]
    out = TestLineSyncOut(
        added=added,
        updated=updated,
        unchanged=unchanged,
        missing=missing,
        removed=payload.remove_missing and bool(missing),
        applied=payload.apply,
    )
    if not payload.apply:
        return out

    # The table's order, then the lines kept that aren't in it.
    order = 0
    for line, ln, values in plan:
        if line is None:
            db.add(
                TestLine(
                    emitter_id=emitter_id,
                    label=ln.label.strip(),
                    expected_mode_id=ln.expected_mode_id,
                    expected_parameters=ln.expected_parameters,
                    import_batch_label=payload.batch_label,
                    created_date=payload.created_date,
                    imported_by=user.id,
                    sort_order=order,
                )
            )
        else:
            for k, v in values.items():
                setattr(line, k, v)
            line.sort_order = order
        order += 1
    for tl in missing_lines:
        if payload.remove_missing:
            db.delete(tl)
        else:
            tl.sort_order = order
            order += 1

    parts = [f"{len(added)} added", f"{len(updated)} updated", f"{len(unchanged)} unchanged"]
    if missing:
        parts.append(f"{len(missing)} {'removed' if payload.remove_missing else 'not in the table, kept'}")
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.test_line.value,
        entity_id=emitter_id,
        summary="Updated SIM Test Lines from a revised table"
        + (f" ({payload.batch_label})" if payload.batch_label else "")
        + ": "
        + ", ".join(parts),
        changes=payload.model_dump(mode="json"),
        emitter_id=emitter_id,
    )
    db.commit()
    return out


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
    return _to_out(line, latest_line_outcomes(db, [line.id]).get(line.id))


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
