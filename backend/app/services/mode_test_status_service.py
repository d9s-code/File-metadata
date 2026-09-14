from datetime import date
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.enums import TestRecordModeLinkType, TestResult
from app.models.mode import Mode
from app.models.test_record import TestRecord, TestRecordMode
from app.schemas.mode import ModeOut, TestRecordBrief


def get_last_test_status(db: Session, mode_ids: list[UUID]) -> dict[UUID, tuple[date, TestResult, UUID]]:
    """For each given Mode id, the (test_date, result, test_record_id) of the
    most recent Test Record that exercised it — computed on read from
    test_record_modes/test_records rather than stored on the Mode, so it can
    never drift out of sync with the test history it's derived from. The id
    is what the "Last Tested" column links back to.

    Uses this specific Mode's own per-Mode result (TestRecordMode.result)
    rather than the whole test's aggregate result — falling back to the
    latter only for rows logged before per-Mode results existed, where
    TestRecordMode.result is null.
    """
    if not mode_ids:
        return {}
    result_col = func.coalesce(TestRecordMode.result, TestRecord.result)
    rows = (
        db.query(TestRecordMode.mode_id, TestRecord.test_date, result_col, TestRecord.id)
        .join(TestRecord, TestRecordMode.test_record_id == TestRecord.id)
        .filter(TestRecordMode.mode_id.in_(mode_ids), TestRecordMode.link_type == TestRecordModeLinkType.exercised)
        .order_by(TestRecord.test_date.desc())
        .all()
    )
    status: dict[UUID, tuple[date, TestResult, UUID]] = {}
    for mode_id, test_date, result, test_record_id in rows:
        status.setdefault(mode_id, (test_date, result, test_record_id))
    return status


def get_test_derivations(db: Session, mode_ids: list[UUID]) -> dict[UUID, list[TestRecordBrief]]:
    """For each given Mode id, the Test Record(s) whose findings explain its
    values (TestRecordModeLinkType.derived) — the provenance a "Test-Derived"
    badge in the UI points at, rather than a Source.
    """
    if not mode_ids:
        return {}
    rows = (
        db.query(TestRecordMode.mode_id, TestRecord)
        .join(TestRecord, TestRecordMode.test_record_id == TestRecord.id)
        .filter(TestRecordMode.mode_id.in_(mode_ids), TestRecordMode.link_type == TestRecordModeLinkType.derived)
        .order_by(TestRecord.test_date.desc())
        .all()
    )
    derivations: dict[UUID, list[TestRecordBrief]] = {}
    for mode_id, record in rows:
        derivations.setdefault(mode_id, []).append(TestRecordBrief.model_validate(record))
    return derivations


def attach_mode_extras(db: Session, modes: list[Mode]) -> list[ModeOut]:
    """Builds ModeOut list with the read-computed extras (last test status,
    test-derivation provenance) attached — the one place both Mode list
    endpoints (per-EW-Group and per-Emitter) build their response, so the two
    never drift out of sync on what they attach.
    """
    mode_ids = [m.id for m in modes]
    test_status = get_last_test_status(db, mode_ids)
    derivations = get_test_derivations(db, mode_ids)
    results = []
    for m in modes:
        out = ModeOut.model_validate(m)
        if m.id in test_status:
            out.last_tested_at, out.last_test_result, out.last_test_record_id = test_status[m.id]
        out.derived_from_test_records = derivations.get(m.id, [])
        results.append(out)
    return results
