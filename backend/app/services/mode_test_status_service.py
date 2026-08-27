from datetime import date
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.enums import TestResult
from app.models.test_record import TestRecord, TestRecordMode


def get_last_test_status(db: Session, mode_ids: list[UUID]) -> dict[UUID, tuple[date, TestResult]]:
    """For each given Mode id, the (test_date, result) of the most recent Test
    Record that exercised it — computed on read from test_record_modes/
    test_records rather than stored on the Mode, so it can never drift out of
    sync with the test history it's derived from.
    """
    if not mode_ids:
        return {}
    rows = (
        db.query(TestRecordMode.mode_id, TestRecord.test_date, TestRecord.result)
        .join(TestRecord, TestRecordMode.test_record_id == TestRecord.id)
        .filter(TestRecordMode.mode_id.in_(mode_ids))
        .order_by(TestRecord.test_date.desc())
        .all()
    )
    status: dict[UUID, tuple[date, TestResult]] = {}
    for mode_id, test_date, result in rows:
        status.setdefault(mode_id, (test_date, result))
    return status
