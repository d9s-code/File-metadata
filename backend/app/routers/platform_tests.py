"""Platform tests: every Emitter pinned on a Platform tested in one run.
Logging one writes an ordinary test record per Emitter — against the version
the Platform pins — grouped under a PlatformTest, all at once or not at all."""

from collections import Counter
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.enums import AuditAction, AuditEntityType, Role, TestResult, TestScopeType
from app.core.csrf import verify_csrf
from app.database import get_db
from app.deps import require_role
from app.models.dwell import DwellStrategyVersion
from app.models.emitter import Emitter
from app.models.emitter_version import EmitterVersion
from app.models.platform import Platform, PlatformEmitterLink, PlatformVersion
from app.models.scenario import ScenarioEmitter
from app.models.test_record import PlatformTest, TestRecord, TestRunDraft
from app.models.user import User
from app.routers.test_records import _create_test_record
from app.schemas.test_record import PlatformTestCreate, PlatformTestEmitterOut, PlatformTestOut
from app.services import scenario_service
from app.services.audit_service import record_audit
from app.services.rf_range import emitter_rf_range
from app.services.test_result_service import compute_overall_result

router = APIRouter(tags=["platform-tests"])


def _live_platform(db: Session, platform_id: UUID) -> Platform:
    platform = db.get(Platform, platform_id)
    if platform is None or platform.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Platform not found")
    return platform


def _dwell_of(db: Session, version_id: UUID | None) -> dict:
    version = db.get(DwellStrategyVersion, version_id) if version_id else None
    if version is None:
        return {}
    return {
        "dwell_strategy_version_id": version.id,
        "dwell_strategy_id": version.strategy_id,
        "dwell_strategy_name": version.snapshot.get("name"),
        "dwell_strategy_version_number": version.version_number,
    }


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
    numbers: dict = {}
    rf: dict = {}
    if version_ids:
        for version_id, number, snapshot in (
            db.query(EmitterVersion.id, EmitterVersion.version_number, EmitterVersion.snapshot)
            .filter(EmitterVersion.id.in_(version_ids))
            .all()
        ):
            numbers[version_id] = number
            rf[version_id] = emitter_rf_range(snapshot)
    numbers |= dict(
        db.query(PlatformVersion.id, PlatformVersion.version_number).filter(PlatformVersion.id.in_(version_ids)).all()
    ) if version_ids else {}
    from app.services.platform_minor import version_labels

    platform_labels = version_labels(db, [t.platform_version_id for t in tests])
    users = dict(
        db.query(User.id, User.username).filter(User.id.in_({t.tested_by for t in tests if t.tested_by})).all()
    )
    by_test: dict[UUID, list[TestRecord]] = {}
    for r in records:
        by_test.setdefault(r.platform_test_id, []).append(r)
    # What was observed of each Emitter with the rest on the air (newer runs).
    observed: dict[UUID, list[ScenarioEmitter]] = {}
    for row in (
        db.query(ScenarioEmitter)
        .filter(ScenarioEmitter.platform_test_id.in_([t.id for t in tests]))
        .order_by(ScenarioEmitter.sort_order)
        .all()
    ):
        observed.setdefault(row.platform_test_id, []).append(row)

    out = []
    for t in tests:
        rows = []
        seen_rows = {row.emitter_id: row for row in observed.get(t.id, [])}
        for r in by_test.get(t.id, []):
            emitter = emitters.get(r.scope_id)
            seen = seen_rows.get(r.scope_id)
            rows.append(
                PlatformTestEmitterOut(
                    test_record_id=r.id,
                    emitter_id=r.scope_id,
                    emitter_name=emitter.name if emitter else "(deleted Emitter)",
                    designation=emitter.designation if emitter else None,
                    version_number=numbers.get(r.emitter_version_id),
                    rf_min_mhz=rf.get(r.emitter_version_id, (None, None))[0],
                    rf_max_mhz=rf.get(r.emitter_version_id, (None, None))[1],
                    result=r.result,
                    computed_result=r.computed_result,
                    lines=len(r.lines),
                    modes=len(r.modes),
                    signals=len(r.signals),
                    line_counts=dict(Counter(line.outcome.value for line in r.lines)),
                    mode_counts=dict(Counter(m.result.value for m in r.modes if m.result is not None)),
                    notes=r.notes if r.notes and r.notes != t.notes else None,
                    simulation_created_date=r.simulation_created_date,
                    observed=scenario_service.out(seen) if seen else None,
                )
            )
        # As the Emitters read: "designation — name", or the name alone.
        rows.sort(key=lambda row: f"{row.designation} — {row.emitter_name}".lower() if row.designation else row.emitter_name.lower())
        verdict = scenario_service.verdicts(observed.get(t.id, []))
        out.append(
            PlatformTestOut(
                id=t.id,
                platform_id=t.platform_id,
                platform_version_number=numbers.get(t.platform_version_id),
                platform_version_label=platform_labels.get(t.platform_version_id),
                title=t.title,
                test_type=t.test_type,
                test_date=t.test_date,
                notes=t.notes,
                tested_by_username=users.get(t.tested_by),
                created_at=t.created_at,
                received_power_dbfs=t.received_power_dbfs,
                **_dwell_of(db, t.dwell_strategy_version_id),
                result=scenario_service.overall(verdict, [row.result for row in rows])
                if rows
                else compute_overall_result([TestResult.inconclusive]),
                emitters=rows,
                verdicts=verdict,
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
    observed = []
    for entry in payload.emitters:
        if entry.emitter_id not in pins:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Emitter {entry.emitter_id} isn't pinned on this Platform")
        if entry.emitter_id in seen:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Emitter {entry.emitter_id} is in the run twice")
        seen.add(entry.emitter_id)
        # What was observed with the rest on the air gives the result, unless
        # one was set or the Emitter's own lines and Modes give it.
        if entry.observed():
            observed.append(entry)
            if entry.result is None and not entry.line_results and not entry.mode_results:
                entry = entry.model_copy(update={"result": scenario_service.worked_out(entry)})
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
    dwell_version = None
    if payload.dwell_strategy_version_id is not None:
        dwell_version = db.get(DwellStrategyVersion, payload.dwell_strategy_version_id)
        if dwell_version is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "That Dwell Strategy version wasn't found")
        # One covering this Platform, or a default dwell.
        if not dwell_version.strategy.is_default and platform_id not in dwell_version.strategy.platform_ids:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That Dwell Strategy doesn't cover this Platform")
    # Checked before anything is written: a run that doesn't fit is refused whole.
    observed_rows = _observe(db, platform, pins, observed, records, dwell_version) if observed else []
    test = PlatformTest(
        platform_id=platform_id,
        platform_version_id=latest_version.id if latest_version else None,
        dwell_strategy_version_id=payload.dwell_strategy_version_id,
        title=payload.title,
        test_type=payload.test_type.value,
        test_date=payload.test_date,
        notes=payload.notes,
        received_power_dbfs=payload.received_power_dbfs,
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
    for row in observed_rows:
        row.platform_test_id = test.id
        db.add(row)
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
        summary=f"Logged a Platform test '{payload.title}' over {len(records)} Emitter{'s' if len(records) != 1 else ''}"
        + _observed_note(observed),
    )
    db.commit()
    [out] = _out(db, [test])
    return out


def _observed_note(observed) -> str:
    """" — 3 of 4 detected, 1 mix-up" for the audit entry."""
    if not observed:
        return ""
    detected = sum(1 for o in observed if o.detected)
    mixups = sum(len(o.reports) for o in observed)
    return f" — {detected} of {len(observed)} detected, {mixups} mix-up{'s' if mixups != 1 else ''}"


def _observe(db: Session, platform: Platform, pins: dict, observed, records, dwell_version) -> list[ScenarioEmitter]:
    """Keep what was observed of each Emitter, checked against the run: a
    mix-up names another of the Platform's Emitters, Modes are of the
    pinned versions, the dwell is one of the Strategy version's."""
    versions = {
        v.id: v
        for v in db.query(EmitterVersion).filter(EmitterVersion.id.in_([link.emitter_version_id for link in pins.values()]))
    }
    names = dict(db.query(Emitter.id, Emitter.name).filter(Emitter.id.in_(list(pins))).all())
    candidates = {
        emitter_id: [
            scenario_service.Candidate(
                emitter_id=emitter_id,
                name=names.get(emitter_id) or (versions[link.emitter_version_id].snapshot or {}).get("name", "(Emitter)"),
                platform_id=platform.id,
                platform_name=platform.name,
                modes=scenario_service.mode_names(versions[link.emitter_version_id].snapshot if link.emitter_version_id in versions else None),
            )
        ]
        for emitter_id, link in pins.items()
    }
    results = {emitter_id: record.result_override or record.result for emitter_id, record in records}
    dwells = (dwell_version.snapshot or {}).get("dwells") or [] if dwell_version else None
    rows = []
    for i, entry in enumerate(observed):
        try:
            rows.append(
                scenario_service.build(
                    entry,
                    emitter=candidates[entry.emitter_id][0],
                    candidates=candidates,
                    dwells=dwells,
                    result=results.get(entry.emitter_id) or scenario_service.worked_out(entry),
                    notes=entry.notes,
                    sort_order=i,
                )
            )
        except scenario_service.ScenarioError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    return rows
