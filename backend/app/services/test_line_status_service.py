from datetime import date
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.enums import TestResult
from app.models.emitter_version import EmitterVersion
from app.models.mode import Mode
from app.models.test_line import TestLine
from app.models.test_record import TestRecord, TestRecordLine, TestRecordLineMode


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


def outdated_line_results(db: Session, latest: dict[UUID, tuple[date, TestResult, UUID]]) -> dict[UUID, str]:
    """The latest results that no longer say anything, and why: a Mode the
    line was intercepted as, or the Mode it was expected to be (as the run's
    tested version had it), has since been deleted — e.g. every Mode replaced
    by an import. Such a result doesn't count as correct (or wrong) until the
    SIM test is run again. Lines not listed still hold."""
    if not latest:
        return {}
    pairs = {(record_id, line_id) for line_id, (_d, _o, record_id) in latest.items()}
    named: dict[UUID, dict[UUID, str]] = {line_id: {} for line_id in latest}
    for line_id, record_id, mode_id, mode_name in (
        db.query(TestRecordLine.test_line_id, TestRecordLine.test_record_id, TestRecordLineMode.mode_id, TestRecordLineMode.mode_name)
        .join(TestRecordLineMode, TestRecordLineMode.test_record_line_id == TestRecordLine.id)
        .filter(TestRecordLine.test_line_id.in_(list(latest)), TestRecordLine.test_record_id.in_({r for r, _l in pairs}))
        .all()
    ):
        if (record_id, line_id) in pairs:
            named[line_id][mode_id] = mode_name or "a Mode"
    # What each line expected when its run was logged, from the version tested.
    tested = dict(
        db.query(TestRecord.id, EmitterVersion.snapshot)
        .join(EmitterVersion, TestRecord.emitter_version_id == EmitterVersion.id)
        .filter(TestRecord.id.in_({r for r, _l in pairs}))
        .all()
    )
    # …unless the run intercepted the Mode the line expects now (a run logged
    # before the replacement Modes were saved in a version).
    expects_now = dict(db.query(TestLine.id, TestLine.expected_mode_id).filter(TestLine.id.in_(list(latest))).all())
    for line_id, (_d, _o, record_id) in latest.items():
        if expects_now.get(line_id) in named[line_id]:
            continue
        for tl in (tested.get(record_id) or {}).get("test_lines", []):
            if tl.get("id") == str(line_id) and tl.get("expected_mode_id"):
                named[line_id].setdefault(UUID(tl["expected_mode_id"]), tl.get("expected_mode_name") or "its expected Mode")
    ids = {mode_id for modes in named.values() for mode_id in modes}
    alive = {m for (m,) in db.query(Mode.id).filter(Mode.id.in_(ids))} if ids else set()
    out: dict[UUID, str] = {}
    for line_id, modes in named.items():
        gone = sorted({name for mode_id, name in modes.items() if mode_id not in alive})
        if gone:
            out[line_id] = f"{', '.join(gone)} {'was' if len(gone) == 1 else 'were'} deleted since the run"
    return out
