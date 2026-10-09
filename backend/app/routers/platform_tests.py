"""Platform tests: every Emitter pinned on a Platform tested in one run.
Logging one writes an ordinary test record per Emitter — against the version
the Platform pins — grouped under a PlatformTest, all at once or not at all."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.enums import AuditAction, AuditEntityType, Role, TestScopeType
from app.core.csrf import verify_csrf
from app.database import get_db
from app.deps import require_role
from app.models.emitter import Emitter
from app.models.emitter_version import EmitterVersion
from app.models.platform import Platform, PlatformEmitterLink, PlatformVersion
from app.models.test_record import PlatformTest, TestRecord, TestRunDraft
from app.models.user import User
from app.routers.test_records import _create_test_record
from app.schemas.test_record import PlatformTestCreate, PlatformTestEmitterOut, PlatformTestOut
from app.services.audit_service import record_audit
from app.services.test_result_service import compute_overall_result

router = APIRouter(tags=["platform-tests"])


def _live_platform(db: Session, platform_id: UUID) -> Platform:
    platform = db.get(Platform, platform_id)
    if platform is None or platform.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Platform not found")
    return platform


def _out(db: Session, tests: list[PlatformTest]) -> list[PlatformTestOut]:
    if not tests:
        return []
    records = db.query(TestRecord).filter(TestRecord.platform_test_id.in_([t.id for t in tests])).all()
    emitters = {
        e.id: e for e in db.query(Emitter).filter(Emitter.id.in_({r.scope_id for r in records})).all()
    } if records else {}
    version_ids = {r.emitter_version_id for r in records if r.emitter_version_id} | {
        t.platform_version_id for t in tests if t.platform_version_id
    }
    numbers = dict(
        db.query(EmitterVersion.id, EmitterVersion.version_number).filter(EmitterVersion.id.in_(version_ids)).all()
    ) if version_ids else {}
    numbers |= dict(
        db.query(PlatformVersion.id, PlatformVersion.version_number).filter(PlatformVersion.id.in_(version_ids)).all()
    ) if version_ids else {}
    users = dict(
        db.query(User.id, User.username).filter(User.id.in_({t.tested_by for t in tests if t.tested_by})).all()
    )
    by_test: dict[UUID, list[TestRecord]] = {}
    for r in records:
        by_test.setdefault(r.platform_test_id, []).append(r)

    out = []
    for t in tests:
        rows = []
        for r in by_test.get(t.id, []):
            emitter = emitters.get(r.scope_id)
            rows.append(
                PlatformTestEmitterOut(
                    test_record_id=r.id,
                    emitter_id=r.scope_id,
                    emitter_name=emitter.name if emitter else "(deleted Emitter)",
                    designation=emitter.designation if emitter else None,
                    version_number=numbers.get(r.emitter_version_id),
                    result=r.result,
                    computed_result=r.computed_result,
                    lines=len(r.lines),
                    modes=len(r.modes),
                    signals=len(r.signals),
                )
            )
        rows.sort(key=lambda row: ((row.designation or "").lower(), row.emitter_name.lower()))
        out.append(
            PlatformTestOut(
                id=t.id,
                platform_id=t.platform_id,
                platform_version_number=numbers.get(t.platform_version_id),
                title=t.title,
                test_type=t.test_type,
                test_date=t.test_date,
                notes=t.notes,
                tested_by_username=users.get(t.tested_by),
                created_at=t.created_at,
                result=compute_overall_result([row.result for row in rows]),
                emitters=rows,
            )
        )
    return out


@router.get("/platforms/{platform_id}/tests", response_model=list[PlatformTestOut])
def list_platform_tests(platform_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))):
    _live_platform(db, platform_id)
    tests = (
        db.query(PlatformTest)
        .filter(PlatformTest.platform_id == platform_id)
        .order_by(PlatformTest.test_date.desc(), PlatformTest.created_at.desc())
        .all()
    )
    # A test whose every record was deleted has nothing left to show.
    return [t for t in _out(db, tests) if t.emitters] if tests else []


@router.get("/platform-tests/{test_id}", response_model=PlatformTestOut)
def get_platform_test(test_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))):
    test = db.get(PlatformTest, test_id)
    if test is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Platform test not found")
    [out] = _out(db, [test])
    return out


@router.post(
    "/platforms/{platform_id}/tests",
    response_model=PlatformTestOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def log_platform_test(
    platform_id: UUID,
    payload: PlatformTestCreate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
):
    """Log a run over the Platform's pinned Emitters: a test record for each
    Emitter in it, against the pinned version, all in one transaction."""
    platform = _live_platform(db, platform_id)
    pins = {
        link.emitter_id: link
        for link in db.query(PlatformEmitterLink).filter(PlatformEmitterLink.platform_id == platform_id).all()
    }
    seen: set[UUID] = set()
    records = []
    for entry in payload.emitters:
        if entry.emitter_id not in pins:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Emitter {entry.emitter_id} isn't pinned on this Platform")
        if entry.emitter_id in seen:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Emitter {entry.emitter_id} is in the run twice")
        seen.add(entry.emitter_id)
        try:
            records.append((entry.emitter_id, payload.record_for(entry)))
        except ValidationError as exc:
            emitter = db.get(Emitter, entry.emitter_id)
            reason = "; ".join(e["msg"].removeprefix("Value error, ") for e in exc.errors())
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, f"{emitter.name if emitter else entry.emitter_id}: {reason}"
            ) from exc

    latest_version = (
        db.query(PlatformVersion)
        .filter(PlatformVersion.platform_id == platform_id)
        .order_by(PlatformVersion.version_number.desc())
        .first()
    )
    test = PlatformTest(
        platform_id=platform_id,
        platform_version_id=latest_version.id if latest_version else None,
        title=payload.title,
        test_type=payload.test_type.value,
        test_date=payload.test_date,
        notes=payload.notes,
        tested_by=user.id,
    )
    db.add(test)
    db.flush()
    for emitter_id, record in records:
        _create_test_record(
            db,
            scope_type=TestScopeType.emitter,
            scope_id=emitter_id,
            emitter_version_id=pins[emitter_id].emitter_version_id,
            mdf_version_id=None,
            payload=record,
            tested_by=user.id,
            emitter_id=emitter_id,
            platform_test_id=test.id,
            commit=False,
        )
    if payload.draft_id is not None:
        db.query(TestRunDraft).filter(
            TestRunDraft.id == payload.draft_id, TestRunDraft.platform_id == platform_id
        ).delete(synchronize_session=False)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.platform.value,
        entity_id=platform.id,
        summary=f"Logged a Platform test '{payload.title}' over {len(records)} Emitter{'s' if len(records) != 1 else ''}",
    )
    db.commit()
    [out] = _out(db, [test])
    return out
