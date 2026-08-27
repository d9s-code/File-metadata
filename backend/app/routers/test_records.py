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
from app.models.mode import Mode
from app.models.test_record import TestRecord, TestRecordMode
from app.schemas.test_record import TestRecordCreate, TestRecordOut
from app.services.audit_service import record_audit

_MODES_EAGER_LOAD = joinedload(TestRecord.modes).joinedload(TestRecordMode.mode)

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
) -> TestRecord:
    if payload.mode_ids:
        found_ids = {m.id for m in db.query(Mode.id).filter(Mode.id.in_(payload.mode_ids)).all()}
        missing = set(payload.mode_ids) - found_ids
        if missing:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown mode id(s): {missing}")

    record = TestRecord(
        scope_type=scope_type,
        scope_id=scope_id,
        emitter_version_id=emitter_version_id,
        mdf_version_id=mdf_version_id,
        test_type=payload.test_type,
        result=payload.result,
        title=payload.title,
        notes=payload.notes,
        test_date=payload.test_date,
        simulation_created_date=payload.simulation_created_date,
        tested_by=tested_by,
    )
    db.add(record)
    db.flush()
    for mode_id in payload.mode_ids:
        db.add(TestRecordMode(test_record_id=record.id, mode_id=mode_id))
    record_audit(
        db,
        actor_id=tested_by,
        action=AuditAction.create,
        entity_type=AuditEntityType.test_record.value,
        entity_id=record.id,
        summary=f"Logged a {payload.test_type.value.replace('_', ' ')} test '{payload.title}' ({payload.result.value})",
        changes=payload.model_dump(mode="json"),
    )
    db.commit()
    return db.query(TestRecord).options(_MODES_EAGER_LOAD).filter(TestRecord.id == record.id).one()


@emitter_router.get("", response_model=list[TestRecordOut])
def list_emitter_test_records(
    emitter_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[TestRecord]:
    if db.get(Emitter, emitter_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    return (
        db.query(TestRecord)
        .options(_MODES_EAGER_LOAD)
        .filter(TestRecord.scope_type == TestScopeType.emitter, TestRecord.scope_id == emitter_id)
        .order_by(TestRecord.test_date.desc())
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
    )


@mdf_router.get("", response_model=list[TestRecordOut])
def list_mdf_test_records(
    mdf_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[TestRecord]:
    if db.get(Mdf, mdf_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MDF not found")
    return (
        db.query(TestRecord)
        .options(_MODES_EAGER_LOAD)
        .filter(TestRecord.scope_type == TestScopeType.mdf, TestRecord.scope_id == mdf_id)
        .order_by(TestRecord.test_date.desc())
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
