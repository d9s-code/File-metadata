from datetime import date
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.enums import TestRecordModeLinkType, TestResult
from app.models.intercept import Intercept, InterceptEntry, InterceptEntryMode
from app.models.mode import Mode
from app.models.test_record import TestRecord, TestRecordLine, TestRecordLineMode, TestRecordMode
from app.schemas.intercept import InterceptEntryBrief
from app.schemas.mode import ModeOut, TestRecordBrief


# Within one run a Mode can be reported for several SIM lines: it counts by
# its worst outcome there (reported once for the wrong signal is the news).
_WORST_FIRST = {TestResult.fail: 0, TestResult.partial: 1, TestResult.inconclusive: 2, TestResult.pass_: 3}


def get_last_seen(db: Session, mode_ids: list[UUID]) -> dict[UUID, dict]:
    """For each given Mode id, the test runs it turned up in — rated in an
    intercept run (per-Mode result; the whole test's result for rows logged
    before per-Mode results existed) or reported under "Intercepted as" for
    a SIM line in a simulation run (that line's outcome). Gives the latest
    run's date, outcome and id (what "Last seen" shows and links to) and how
    many runs ended each way. Computed on read, so it can't drift from the
    test history."""
    if not mode_ids:
        return {}
    rated = (
        db.query(
            TestRecordMode.mode_id,
            TestRecord.id,
            TestRecord.test_date,
            TestRecord.created_at,
            func.coalesce(TestRecordMode.result, TestRecord.result),
        )
        .join(TestRecord, TestRecordMode.test_record_id == TestRecord.id)
        .filter(TestRecordMode.mode_id.in_(mode_ids), TestRecordMode.link_type == TestRecordModeLinkType.exercised)
        .all()
    )
    reported = (
        db.query(TestRecordLineMode.mode_id, TestRecord.id, TestRecord.test_date, TestRecord.created_at, TestRecordLine.outcome)
        .join(TestRecordLine, TestRecordLineMode.test_record_line_id == TestRecordLine.id)
        .join(TestRecord, TestRecordLine.test_record_id == TestRecord.id)
        .filter(TestRecordLineMode.mode_id.in_(mode_ids))
        .all()
    )
    # (mode, run) -> worst outcome in that run
    runs: dict[tuple[UUID, UUID], tuple[date, object, TestResult]] = {}
    for mode_id, record_id, test_date, created_at, result in [*rated, *reported]:
        key = (mode_id, record_id)
        prior = runs.get(key)
        if prior is None or _WORST_FIRST[result] < _WORST_FIRST[prior[2]]:
            runs[key] = (test_date, created_at, result)
    seen: dict[UUID, dict] = {}
    for (mode_id, record_id), (test_date, created_at, result) in runs.items():
        entry = seen.setdefault(mode_id, {"latest": None, "counts": {}})
        entry["counts"][result.value] = entry["counts"].get(result.value, 0) + 1
        if entry["latest"] is None or (test_date, created_at) > entry["latest"][:2]:
            entry["latest"] = (test_date, created_at, result, record_id)
    return seen


def get_last_test_status(db: Session, mode_ids: list[UUID]) -> dict[UUID, tuple[date, TestResult, UUID]]:
    """For each given Mode id, (test_date, outcome, test_record_id) of the
    latest run it was seen in — see get_last_seen."""
    return {m: (v["latest"][0], v["latest"][2], v["latest"][3]) for m, v in get_last_seen(db, mode_ids).items()}


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


def get_intercept_derivations(db: Session, mode_ids: list[UUID]) -> dict[UUID, list[InterceptEntryBrief]]:
    """For each given Mode id, the Intercept Entry/Entries it was pre-filled
    from — the provenance an "Intercept-Derived" badge in the UI points at.
    """
    if not mode_ids:
        return {}
    rows = (
        db.query(InterceptEntryMode.mode_id, InterceptEntry, Intercept.name)
        .join(InterceptEntry, InterceptEntryMode.intercept_entry_id == InterceptEntry.id)
        .join(Intercept, InterceptEntry.intercept_id == Intercept.id)
        .filter(InterceptEntryMode.mode_id.in_(mode_ids))
        .order_by(InterceptEntry.created_at.desc())
        .all()
    )
    derivations: dict[UUID, list[InterceptEntryBrief]] = {}
    for mode_id, entry, intercept_name in rows:
        brief = InterceptEntryBrief.model_validate(entry)
        brief.intercept_name = intercept_name
        derivations.setdefault(mode_id, []).append(brief)
    return derivations


def attach_mode_extras(db: Session, modes: list[Mode]) -> list[ModeOut]:
    """Builds ModeOut list with the read-computed extras (last test status,
    test-derivation provenance) attached — the one place both Mode list
    endpoints (per-EW-Group and per-Emitter) build their response, so the two
    never drift out of sync on what they attach.
    """
    mode_ids = [m.id for m in modes]
    seen = get_last_seen(db, mode_ids)
    derivations = get_test_derivations(db, mode_ids)
    intercept_derivations = get_intercept_derivations(db, mode_ids)
    results = []
    for m in modes:
        out = ModeOut.model_validate(m)
        if m.id in seen:
            test_date, _, result, record_id = seen[m.id]["latest"]
            out.last_tested_at, out.last_test_result, out.last_test_record_id = test_date, result, record_id
            out.seen_counts = seen[m.id]["counts"]
        out.derived_from_test_records = derivations.get(m.id, [])
        out.derived_from_intercepts = intercept_derivations.get(m.id, [])
        results.append(out)
    return results
