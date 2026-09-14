from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.enums import ModeStatus, TestResult
from app.models.emitter import Emitter
from app.models.ew_group import EwGroup
from app.models.mode import Mode, ModeLine
from app.schemas.emitter import EmitterOut, EmitterSummary
from app.services.mode_test_status_service import get_last_test_status


def compute_emitter_summaries(db: Session, emitter_ids: list[UUID]) -> dict[UUID, EmitterSummary]:
    """RF/PW/PRI extremes + test-pass count per Emitter, in two bulk queries
    regardless of how many Emitters are asked for — see EmitterSummary's
    docstring for what this deliberately does and doesn't cover.
    """
    if not emitter_ids:
        return {}

    extreme_rows = (
        db.query(
            EwGroup.emitter_id,
            func.min(ModeLine.rf_min_mhz),
            func.max(ModeLine.rf_max_mhz),
            func.min(ModeLine.pw_min_us),
            func.max(ModeLine.pw_max_us),
            func.min(ModeLine.pri_min_us),
            func.max(ModeLine.pri_max_us),
            func.count(Mode.id),
        )
        .select_from(Mode)
        .join(EwGroup, Mode.ew_group_id == EwGroup.id)
        .join(ModeLine, ModeLine.mode_id == Mode.id)
        .filter(EwGroup.emitter_id.in_(emitter_ids), Mode.status == ModeStatus.approved)
        .group_by(EwGroup.emitter_id)
        .all()
    )

    scan_rows = (
        db.query(EwGroup.emitter_id, func.min(EwGroup.scan_min), func.max(EwGroup.scan_max))
        .filter(EwGroup.emitter_id.in_(emitter_ids))
        .group_by(EwGroup.emitter_id)
        .all()
    )
    scan_by_emitter = {emitter_id: (scan_min, scan_max) for emitter_id, scan_min, scan_max in scan_rows}

    mode_rows = (
        db.query(Mode.id, EwGroup.emitter_id)
        .join(EwGroup, Mode.ew_group_id == EwGroup.id)
        .filter(EwGroup.emitter_id.in_(emitter_ids), Mode.status == ModeStatus.approved)
        .all()
    )
    mode_to_emitter = {mode_id: emitter_id for mode_id, emitter_id in mode_rows}
    test_status = get_last_test_status(db, list(mode_to_emitter))

    passing_by_emitter: dict[UUID, int] = {}
    for mode_id, (_test_date, result, _test_record_id) in test_status.items():
        if result == TestResult.pass_:
            emitter_id = mode_to_emitter.get(mode_id)
            if emitter_id is not None:
                passing_by_emitter[emitter_id] = passing_by_emitter.get(emitter_id, 0) + 1

    summaries: dict[UUID, EmitterSummary] = {}
    for row in extreme_rows:
        emitter_id, rf_min, rf_max, pw_min, pw_max, pri_min, pri_max, mode_count = row
        scan_min, scan_max = scan_by_emitter.get(emitter_id, (None, None))
        summaries[emitter_id] = EmitterSummary(
            rf_min_mhz=rf_min,
            rf_max_mhz=rf_max,
            pw_min_us=pw_min,
            pw_max_us=pw_max,
            pri_min_us=pri_min,
            pri_max_us=pri_max,
            scan_min=scan_min,
            scan_max=scan_max,
            mode_count=mode_count,
            modes_passing=passing_by_emitter.get(emitter_id, 0),
        )
    for emitter_id in emitter_ids:
        scan_min, scan_max = scan_by_emitter.get(emitter_id, (None, None))
        summaries.setdefault(emitter_id, EmitterSummary(scan_min=scan_min, scan_max=scan_max))
    return summaries


def attach_emitter_summaries(db: Session, emitters: list[Emitter]) -> list[EmitterOut]:
    """The one place every Emitter read endpoint builds its response, so list
    and detail views never drift on what's attached — mirrors
    mode_test_status_service.attach_mode_extras.
    """
    summaries = compute_emitter_summaries(db, [e.id for e in emitters])
    results = []
    for e in emitters:
        out = EmitterOut.model_validate(e)
        out.summary = summaries.get(e.id, EmitterSummary())
        results.append(out)
    return results
