from uuid import UUID

from sqlalchemy.orm import Session

from app.core.enums import TestResult
from app.models.test_record import TestRecord, TestRecordFunctionGroup


def get_last_rating(db: Session, function_group_ids: list[UUID]) -> dict[UUID, TestResult]:
    """For each given Function Group id, its current rating — the
    `override_result` (if set) else `computed_result` of its most recent
    `TestRecordFunctionGroup` row, ordered by the owning Test Record's
    `test_date` — mirroring get_last_test_status's "most recent wins"
    pattern for per-Mode status.
    """
    if not function_group_ids:
        return {}
    rows = (
        db.query(
            TestRecordFunctionGroup.function_group_id,
            TestRecordFunctionGroup.computed_result,
            TestRecordFunctionGroup.override_result,
        )
        .join(TestRecord, TestRecordFunctionGroup.test_record_id == TestRecord.id)
        .filter(TestRecordFunctionGroup.function_group_id.in_(function_group_ids))
        .order_by(TestRecord.test_date.desc())
        .all()
    )
    ratings: dict[UUID, TestResult] = {}
    for function_group_id, computed_result, override_result in rows:
        ratings.setdefault(function_group_id, override_result or computed_result)
    return ratings
