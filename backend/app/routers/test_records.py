from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role, TestScopeType
from app.database import get_db
from app.deps import require_role
from app.models.emitter import Emitter
from app.models.emitter_version import EmitterVersion
from app.models.mdf import Mdf, MdfVersion
from app.models.ew_group import EwGroup
from app.models.mode import Mode
from app.models.test_line import TestLine
from app.models.test_record import (
    TestRecord,
    TestRecordLine,
    TestRecordLineMode,
    TestRecordMode,
    TestRunDraft,
)
from app.schemas.test_record import TestRecordCreate, TestRecordOut, TestResultChange
from app.services.audit_service import record_audit
from app.services.test_result_service import compute_overall_result

_MODES_EAGER_LOAD = joinedload(TestRecord.modes).joinedload(TestRecordMode.mode)
_LINES_EAGER_LOAD = joinedload(TestRecord.lines).options(
    joinedload(TestRecordLine.test_line),
    joinedload(TestRecordLine.intercepted_modes).joinedload(TestRecordLineMode.mode),
)

emitter_router = APIRouter(prefix="/emitters/{emitter_id}/test-records", tags=["test-records"])
mdf_router = APIRouter(prefix="/mdfs/{mdf_id}/test-records", tags=["test-records"])


def _latest_emitter_version_id(db: Session, emitter_id: UUID) -> UUID | None:
    version = (
        db.query(EmitterVersion)
        .filter(EmitterVersion.emitter_id == emitter_id)
        .order_by(EmitterVersion.version_number.desc())
        .first()
    )
    return version.id if version else None


def _latest_mdf_version_id(db: Session, mdf_id: UUID) -> UUID | None:
    version = db.query(MdfVersion).filter(MdfVersion.mdf_id == mdf_id).order_by(MdfVersion.version_number.desc()).first()
    return version.id if version else None


def _create_test_record(
    db: Session,
    *,
    scope_type: TestScopeType,
    scope_id: UUID,
    emitter_version_id: UUID | None,
    mdf_version_id: UUID | None,
    payload: TestRecordCreate,
    tested_by: UUID,
    emitter_id: UUID | None = None,
) -> TestRecord:
    mode_ids = [mr.mode_id for mr in payload.mode_results]
    if mode_ids:
        found_ids = {m.id for m in db.query(Mode.id).filter(Mode.id.in_(mode_ids)).all()}
        missing = set(mode_ids) - found_ids
        if missing:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown mode id(s): {missing}")

    if payload.line_results:
        if emitter_id is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "line_results requires an Emitter-scoped test")
        line_ids = [lr.test_line_id for lr in payload.line_results]
        found_line_ids = {
            tl.id for tl in db.query(TestLine.id).filter(TestLine.id.in_(line_ids), TestLine.emitter_id == emitter_id).all()
        }
        missing_lines = set(line_ids) - found_line_ids
        if missing_lines:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown test line id(s) for this Emitter: {missing_lines}")
        intercepted_ids = {mid for lr in payload.line_results for mid in lr.intercepted_mode_ids}
        if intercepted_ids:
            found_intercepted = {
                m.id
                for m in db.query(Mode.id)
                .join(EwGroup, Mode.ew_group_id == EwGroup.id)
                .filter(Mode.id.in_(intercepted_ids), EwGroup.emitter_id == emitter_id)
                .all()
            }
            missing_intercepted = intercepted_ids - found_intercepted
            if missing_intercepted:
                raise HTTPException(
                    status.HTTP_404_NOT_FOUND, f"Unknown mode id(s) for this Emitter: {missing_intercepted}"
                )

    if payload.retests_test_record_id is not None:
        retested = db.get(TestRecord, payload.retests_test_record_id)
        if retested is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "retests_test_record_id not found")
        if retested.scope_type != scope_type or retested.scope_id != scope_id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "retests_test_record_id must belong to the same scope"
            )

    # Precedence: an Emitter test's overall result is the intercept-correctness
    # verdict (line_results) whenever any lines were assessed — that's the
    # simulation-centric headline this whole feature exists for — falling back
    # to the per-Mode worst-of, then the manual result, only when there's
    # nothing to derive it from.
    if payload.line_results:
        overall_result = compute_overall_result([lr.outcome for lr in payload.line_results])
    elif payload.mode_results:
        overall_result = compute_overall_result([mr.result for mr in payload.mode_results])
    else:
        overall_result = payload.result
    assert overall_result is not None  # guaranteed by TestRecordCreate.check_result
    computed_result = None
    if payload.result_override is not None and payload.result_override != overall_result:
        computed_result, overall_result = overall_result, payload.result_override

    record = TestRecord(
        scope_type=scope_type,
        scope_id=scope_id,
        emitter_version_id=emitter_version_id,
        mdf_version_id=mdf_version_id,
        test_type=payload.test_type,
        result=overall_result,
        computed_result=computed_result,
        result_note=payload.result_override_note.strip() if computed_result and payload.result_override_note else None,
        title=payload.title,
        notes=payload.notes,
        test_date=payload.test_date,
        test_time=payload.test_time,
        simulation_created_date=payload.simulation_created_date,
        dwell=payload.dwell,
        retests_test_record_id=payload.retests_test_record_id,
        tested_by=tested_by,
    )
    db.add(record)
    db.flush()
    for lr in payload.line_results:
        db.add(
            TestRecordLine(
                test_record_id=record.id,
                test_line_id=lr.test_line_id,
                outcome=lr.outcome,
                notes=lr.notes,
                observed_values=lr.observed_values,
                intercepted_as_unknown=lr.intercepted_as_unknown,
                intercepted_modes=[TestRecordLineMode(mode_id=mid) for mid in lr.intercepted_mode_ids],
            )
        )
    for mr in payload.mode_results:
        db.add(
            TestRecordMode(
                test_record_id=record.id,
                mode_id=mr.mode_id,
                result=mr.result,
                notes=mr.notes,
                observed_values=mr.observed_values,
            )
        )

    if payload.draft_id is not None:
        # Logged: the draft it was filled in as is done with.
        db.query(TestRunDraft).filter(
            TestRunDraft.id == payload.draft_id, TestRunDraft.emitter_id == emitter_id
        ).delete(synchronize_session=False)

    record_audit(
        db,
        actor_id=tested_by,
        action=AuditAction.create,
        entity_type=AuditEntityType.test_record.value,
        entity_id=record.id,
        summary=f"Logged a {payload.test_type.value.replace('_', ' ')} test '{payload.title}' ({overall_result.value})",
        changes=payload.model_dump(mode="json"),
        emitter_id=emitter_id,
    )
    db.commit()
    return (
        db.query(TestRecord)
        .options(_MODES_EAGER_LOAD, _LINES_EAGER_LOAD)
        .filter(TestRecord.id == record.id)
        .one()
    )


@emitter_router.get("", response_model=list[TestRecordOut])
def list_emitter_test_records(
    emitter_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[TestRecord]:
    if db.get(Emitter, emitter_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    return (
        db.query(TestRecord)
        .options(_MODES_EAGER_LOAD, _LINES_EAGER_LOAD)
        .filter(TestRecord.scope_type == TestScopeType.emitter, TestRecord.scope_id == emitter_id)
        .order_by(TestRecord.test_date.desc(), TestRecord.test_time.desc().nulls_last(), TestRecord.created_at.desc())
        .all()
    )


@emitter_router.post(
    "", response_model=TestRecordOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)]
)
def create_emitter_test_record(
    emitter_id: UUID,
    payload: TestRecordCreate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> TestRecord:
    if db.get(Emitter, emitter_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    return _create_test_record(
        db,
        scope_type=TestScopeType.emitter,
        scope_id=emitter_id,
        emitter_version_id=_latest_emitter_version_id(db, emitter_id),
        mdf_version_id=None,
        payload=payload,
        tested_by=user.id,
        emitter_id=emitter_id,
    )


@mdf_router.get("", response_model=list[TestRecordOut])
def list_mdf_test_records(
    mdf_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[TestRecord]:
    if db.get(Mdf, mdf_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MDF not found")
    return (
        db.query(TestRecord)
        .options(_MODES_EAGER_LOAD, _LINES_EAGER_LOAD)
        .filter(TestRecord.scope_type == TestScopeType.mdf, TestRecord.scope_id == mdf_id)
        .order_by(TestRecord.test_date.desc(), TestRecord.test_time.desc().nulls_last(), TestRecord.created_at.desc())
        .all()
    )


@mdf_router.post(
    "", response_model=TestRecordOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)]
)
def create_mdf_test_record(
    mdf_id: UUID,
    payload: TestRecordCreate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> TestRecord:
    if db.get(Mdf, mdf_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MDF not found")
    return _create_test_record(
        db,
        scope_type=TestScopeType.mdf,
        scope_id=mdf_id,
        emitter_version_id=None,
        mdf_version_id=_latest_mdf_version_id(db, mdf_id),
        payload=payload,
        tested_by=user.id,
    )


@emitter_router.patch("/{test_record_id}/result", response_model=TestRecordOut, dependencies=[Depends(verify_csrf)])
def change_emitter_test_result(
    emitter_id: UUID,
    test_record_id: UUID,
    payload: TestResultChange,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> TestRecord:
    """Override a logged run's overall result (with why), or set it back to
    what it worked out to from its lines or Modes."""
    record = db.get(TestRecord, test_record_id)
    if record is None or record.scope_type != TestScopeType.emitter or record.scope_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Test record not found")
    worked_out = record.computed_result or record.result
    old = record.result
    if payload.result == worked_out:
        record.result, record.computed_result, record.result_note = worked_out, None, None
        summary = f"Result of test '{record.title}' set back to the worked-out {worked_out.value}"
    else:
        note = (payload.note or "").strip()
        if not note:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Say why the result is changed")
        record.result, record.computed_result, record.result_note = payload.result, worked_out, note
        summary = f"Result of test '{record.title}' set to {payload.result.value} (worked out: {worked_out.value}) — {note}"
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.test_record.value,
        entity_id=record.id,
        summary=summary,
        changes={"result": {"old": old.value, "new": record.result.value}},
        emitter_id=emitter_id,
    )
    db.commit()
    return (
        db.query(TestRecord)
        .options(_MODES_EAGER_LOAD, _LINES_EAGER_LOAD)
        .filter(TestRecord.id == record.id)
        .one()
    )


@emitter_router.delete(
    "/{test_record_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)]
)
def delete_emitter_test_record(
    emitter_id: UUID, test_record_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> None:
    record = db.get(TestRecord, test_record_id)
    if record is None or record.scope_type != TestScopeType.emitter or record.scope_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Test record not found")
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.test_record.value,
        entity_id=record.id,
        summary=f"Deleted test record '{record.title}'",
        emitter_id=emitter_id,
    )
    db.delete(record)
    db.commit()


@mdf_router.delete("/{test_record_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_mdf_test_record(
    mdf_id: UUID, test_record_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> None:
    record = db.get(TestRecord, test_record_id)
    if record is None or record.scope_type != TestScopeType.mdf or record.scope_id != mdf_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Test record not found")
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.test_record.value,
        entity_id=record.id,
        summary=f"Deleted test record '{record.title}'",
    )
    db.delete(record)
    db.commit()
