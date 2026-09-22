from datetime import date
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.enums import TestResult, TestScopeType
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
