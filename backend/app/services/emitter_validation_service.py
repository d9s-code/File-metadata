from datetime import date
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.enums import TestResult, TestScopeType, TestType
from app.models.test_record import TestRecord, TestRecordLine


def get_last_validation(db: Session, emitter_ids: list[UUID]) -> dict[UUID, tuple[date, TestResult, UUID]]:
    """For each given Emitter id, the (test_date, result, test_record_id) of
    its most recent Test Record that carries at least one Test-Line result —
    i.e. was actually checked against a simulated signal, not just a Mode's
    own behavior. This is the Emitter-level headline ("Last validated against
    simulation") that replaces per-Mode "last tested" as the primary signal
    of an Emitter's state: Modes aren't independent, so a per-Mode pass/fail
    can't say whether the *emitter as a whole* was correctly recognized.
    """
    if not emitter_ids:
        return {}
    rows = (
        db.query(TestRecord.scope_id, TestRecord.test_date, TestRecord.result, TestRecord.id)
        .join(TestRecordLine, TestRecordLine.test_record_id == TestRecord.id)
        .filter(TestRecord.scope_type == TestScopeType.emitter, TestRecord.scope_id.in_(emitter_ids))
        .distinct()
        .order_by(TestRecord.test_date.desc())
        .all()
    )
    status: dict[UUID, tuple[date, TestResult, UUID]] = {}
    for emitter_id, test_date, result, test_record_id in rows:
        status.setdefault(emitter_id, (test_date, result, test_record_id))
    return status


def get_test_dates(db: Session, emitter_ids: list[UUID]) -> dict[UUID, dict]:
    """For each given Emitter id: when it was last tested (its newest Test
    Record of any kind, and that record's id) and the SIM created date of its
    newest simulation run that gives one."""
    if not emitter_ids:
        return {}
    rows = (
        db.query(
            TestRecord.scope_id,
            TestRecord.id,
            TestRecord.test_date,
            TestRecord.test_type,
            TestRecord.simulation_created_date,
        )
        .filter(TestRecord.scope_type == TestScopeType.emitter, TestRecord.scope_id.in_(emitter_ids))
        .order_by(TestRecord.test_date.desc(), TestRecord.test_time.desc().nulls_last(), TestRecord.created_at.desc())
        .all()
    )
    out: dict[UUID, dict] = {}
    for emitter_id, record_id, test_date, test_type, sim_created in rows:
        dates = out.setdefault(emitter_id, {"last_tested_at": test_date, "last_tested_test_record_id": record_id})
        if test_type == TestType.simulation and sim_created is not None and "sim_created_date" not in dates:
            dates["sim_created_date"] = sim_created
    return out
