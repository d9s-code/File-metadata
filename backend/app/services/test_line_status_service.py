from datetime import date
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.enums import TestResult
from app.models.test_record import TestRecord, TestRecordLine


def latest_line_outcomes(db: Session, line_ids: list[UUID]) -> dict[UUID, tuple[date, TestResult, UUID]]:
    """Each SIM Test Line's (test_date, outcome, test_record_id) in the most
    recent test run that included it — latest test_date, then latest logged.
    A line that was never in a run is absent."""
    if not line_ids:
        return {}
    rows = (
        db.query(TestRecordLine.test_line_id, TestRecord.test_date, TestRecordLine.outcome, TestRecord.id)
        .join(TestRecord, TestRecordLine.test_record_id == TestRecord.id)
        .filter(TestRecordLine.test_line_id.in_(line_ids))
        .order_by(TestRecordLine.test_line_id, TestRecord.test_date.desc(), TestRecord.created_at.desc())
        .all()
    )
    latest: dict[UUID, tuple[date, TestResult, UUID]] = {}
    for line_id, test_date, outcome, record_id in rows:
        latest.setdefault(line_id, (test_date, outcome, record_id))
    return latest
