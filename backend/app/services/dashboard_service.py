from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.core.enums import EmitterStatus, MdfStatus, SourceStatus, TestResult
from app.models.audit_log import AuditLog
from app.models.emitter import Emitter
from app.models.emitter_version import EmitterVersion
from app.models.mdf import Mdf
from app.models.source import Source
from app.models.test_line import TestLine
from app.models.test_record import TestRecord, TestRecordLine
from app.schemas.audit_log import AuditLogOut
from app.services.emitter_validation_service import get_last_validation
from app.services.readiness_service import compute_mdf_readiness_warnings
from app.services.test_line_status_service import latest_line_outcomes

STALE_DRAFT_DAYS = 7
RECENT_ACTIVITY_LIMIT = 10
RECENT_TEST_RUNS_LIMIT = 8
# A SIM Test Line's latest outcome, or "untested" when no run included it yet.
SIM_OUTCOME_KEYS = tuple(r.value for r in TestResult) + ("untested",)


def _compute_status_counts(db: Session) -> tuple[dict[str, int], dict[str, int]]:
    emitter_counts = {s.value: 0 for s in EmitterStatus}
    for status_value, count in (
        db.query(Emitter.status, func.count())
        .filter(Emitter.is_deleted.is_(False))
        .group_by(Emitter.status)
        .all()
    ):
        emitter_counts[status_value.value] = count

    mdf_counts = {s.value: 0 for s in MdfStatus}
    for status_value, count in (
        db.query(Mdf.status, func.count()).filter(Mdf.is_deleted.is_(False)).group_by(Mdf.status).all()
    ):
        mdf_counts[status_value.value] = count

    return emitter_counts, mdf_counts


def _compute_needs_attention(db: Session, sim_rows: list[dict]) -> list[dict]:
    needs_attention: list[dict] = []

    cutoff = datetime.now(timezone.utc) - timedelta(days=STALE_DRAFT_DAYS)
    draft_emitters = (
        db.query(Emitter).filter(Emitter.is_deleted.is_(False), Emitter.status == EmitterStatus.draft).all()
    )
    for emitter in draft_emitters:
        last_version = (
            db.query(EmitterVersion)
            .filter(EmitterVersion.emitter_id == emitter.id)
            .order_by(EmitterVersion.version_number.desc())
            .first()
        )
        last_activity = last_version.created_at if last_version else emitter.created_at
        if last_activity < cutoff:
            days = (datetime.now(timezone.utc) - last_activity).days
            needs_attention.append(
                {
                    "message": f"Emitter '{emitter.name}' has been in progress with no commit for {days} days.",
                    "entity_type": "emitter",
                    "entity_id": str(emitter.id),
                    "category": "stale",
                }
            )

    deprecated_emitters = (
        db.query(Emitter).filter(Emitter.is_deleted.is_(False), Emitter.status == EmitterStatus.deprecated).all()
    )
    for emitter in deprecated_emitters:
        if emitter.rework_note:
            message = f"Emitter '{emitter.name}' needs rework: {emitter.rework_note}"
        else:
            message = f"Emitter '{emitter.name}' needs rework."
        needs_attention.append(
            {"message": message, "entity_type": "emitter", "entity_id": str(emitter.id), "category": "rework"}
        )

    needs_attention.extend(_sim_attention_items(sim_rows))

    active_mdfs = (
        db.query(Mdf)
        .filter(Mdf.is_deleted.is_(False), Mdf.status.notin_([MdfStatus.released, MdfStatus.deprecated]))
        .all()
    )
    for mdf in active_mdfs:
        warnings = compute_mdf_readiness_warnings(db, mdf)
        for w in warnings:
            needs_attention.append(
                {
                    "message": f"MDF '{mdf.name}': {w}",
                    "entity_type": "mdf",
                    "entity_id": str(mdf.id),
                    "category": "mdf",
                }
            )

    return needs_attention


def _compute_pending_approvals(db: Session) -> list[dict]:
    pending: list[dict] = []

    pending_sources = (
        db.query(Source, Emitter.name)
        .join(Emitter, Source.emitter_id == Emitter.id)
        .filter(Source.status == SourceStatus.pending_review, Emitter.is_deleted.is_(False))
        .all()
    )
    for source, emitter_name in pending_sources:
        pending.append(
            {
                "message": f"Source '{source.name}' on Emitter '{emitter_name}' is awaiting review.",
                "kind": "source",
                "emitter_id": str(source.emitter_id),
            }
        )

    return pending


def _compute_emitter_sim_status(db: Session) -> list[dict]:
    """One row per Emitter: how its SIM Test Lines did in their latest run,
    and when it was last validated against a simulation."""
    emitters = db.query(Emitter).filter(Emitter.is_deleted.is_(False)).order_by(Emitter.name).all()
    ids = [e.id for e in emitters]
    if not ids:
        return []
    lines = db.query(TestLine.id, TestLine.emitter_id).filter(TestLine.emitter_id.in_(ids)).all()
    outcomes = latest_line_outcomes(db, [line_id for line_id, _ in lines])
    validations = get_last_validation(db, ids)
    # When each validating run was logged — a commit after that is a change
    # the run didn't see. (Its test_date can be earlier than when it was
    # logged, so it would wrongly flag commits made before logging.)
    logged_at = dict(
        db.query(TestRecord.id, TestRecord.created_at)
        .filter(TestRecord.id.in_([v[2] for v in validations.values()]))
        .all()
    )
    # Last commit that changed content — a status change commits a version
    # too, but moving to Testing after a run doesn't make the run stale.
    last_change = dict(
        db.query(EmitterVersion.emitter_id, func.max(EmitterVersion.created_at))
        .filter(EmitterVersion.emitter_id.in_(ids), ~EmitterVersion.change_summary.like("Status: %"))
        .group_by(EmitterVersion.emitter_id)
        .all()
    )

    counts = {e.id: dict.fromkeys(SIM_OUTCOME_KEYS, 0) for e in emitters}
    for line_id, emitter_id in lines:
        latest = outcomes.get(line_id)
        counts[emitter_id][latest[1].value if latest else "untested"] += 1

    rows = []
    for e in emitters:
        validated = validations.get(e.id)
        changed = last_change.get(e.id)
        rows.append(
            {
                "emitter_id": str(e.id),
                "name": e.name,
                "status": e.status.value,
                "line_count": sum(counts[e.id].values()),
                "line_outcomes": counts[e.id],
                "last_validated_at": validated[0].isoformat() if validated else None,
                "last_validated_result": validated[1].value if validated else None,
                "last_validated_test_record_id": str(validated[2]) if validated else None,
                "changed_since_validation": bool(validated and changed and changed > logged_at[validated[2]]),
            }
        )
    return rows


def _sim_attention_items(sim_rows: list[dict]) -> list[dict]:
    items: list[dict] = []
    for row in sim_rows:
        link = {"entity_type": "emitter", "entity_id": row["emitter_id"]}
        name = row["name"]
        wrong = row["line_outcomes"]["fail"] + row["line_outcomes"]["partial"]
        if wrong:
            noun = "SIM Test Line was" if wrong == 1 else "SIM Test Lines were"
            items.append(
                {**link, "category": "sim", "message": f"Emitter '{name}': {wrong} {noun} missed or misclassified in the latest run."}
            )
        if row["status"] == EmitterStatus.in_review.value and row["last_validated_at"] is None:
            items.append(
                {**link, "category": "sim", "message": f"Emitter '{name}' is in Testing but hasn't been checked against a simulation yet."}
            )
        if row["changed_since_validation"] and row["status"] in (EmitterStatus.in_review.value, EmitterStatus.validated.value):
            items.append(
                {
                    **link,
                    "category": "sim",
                    "message": f"Emitter '{name}' was changed after its last simulation test ({row['last_validated_at']}).",
                }
            )
    return items


def _owner_names(db: Session, records: list[TestRecord]) -> tuple[dict, dict]:
    emitter_ids = {r.scope_id for r in records if r.scope_type.value == "emitter"}
    mdf_ids = {r.scope_id for r in records if r.scope_type.value == "mdf"}
    emitter_names = dict(
        db.query(Emitter.id, Emitter.name).filter(Emitter.id.in_(emitter_ids), Emitter.is_deleted.is_(False)).all()
    )
    mdf_names = dict(db.query(Mdf.id, Mdf.name).filter(Mdf.id.in_(mdf_ids), Mdf.is_deleted.is_(False)).all())
    return emitter_names, mdf_names


def _compute_recent_test_runs(db: Session, limit: int = RECENT_TEST_RUNS_LIMIT) -> list[dict]:
    records = (
        db.query(TestRecord).order_by(TestRecord.test_date.desc(), TestRecord.created_at.desc()).limit(limit * 3).all()
    )
    emitter_names, mdf_names = _owner_names(db, records)
    line_counts: dict = {}
    for record_id, outcome, count in (
        db.query(TestRecordLine.test_record_id, TestRecordLine.outcome, func.count())
        .filter(TestRecordLine.test_record_id.in_([r.id for r in records]))
        .group_by(TestRecordLine.test_record_id, TestRecordLine.outcome)
        .all()
    ):
        line_counts.setdefault(record_id, dict.fromkeys((t.value for t in TestResult), 0))[outcome.value] = count

    runs: list[dict] = []
    for r in records:
        is_emitter = r.scope_type.value == "emitter"
        owner_name = emitter_names.get(r.scope_id) if is_emitter else mdf_names.get(r.scope_id)
        if owner_name is None:
            continue  # its Emitter/MDF was deleted
        runs.append(
            {
                "entity_type": "emitter" if is_emitter else "mdf",
                "entity_id": str(r.scope_id),
                "entity_name": owner_name,
                "test_record_id": str(r.id),
                "title": r.title,
                "test_type": r.test_type.value,
                "result": r.result.value,
                "test_date": r.test_date.isoformat(),
                "line_outcomes": line_counts.get(r.id),
            }
        )
        if len(runs) == limit:
            break
    return runs


def _compute_needs_redo(db: Session) -> list[dict]:
    retested_ids = db.query(TestRecord.retests_test_record_id).filter(
        TestRecord.retests_test_record_id.isnot(None)
    )
    records = (
        db.query(TestRecord)
        .filter(TestRecord.result.in_([TestResult.fail, TestResult.partial]), ~TestRecord.id.in_(retested_ids))
        .order_by(TestRecord.test_date.desc())
        .all()
    )
    if not records:
        return []

    emitter_names, mdf_names = _owner_names(db, records)

    needs_redo: list[dict] = []
    for r in records:
        is_emitter = r.scope_type.value == "emitter"
        owner_name = emitter_names.get(r.scope_id) if is_emitter else mdf_names.get(r.scope_id)
        if owner_name is None:
            continue
        needs_redo.append(
            {
                "entity_type": "emitter" if is_emitter else "mdf",
                "entity_id": str(r.scope_id),
                "entity_name": owner_name,
                "test_record_id": str(r.id),
                "title": r.title,
                "result": r.result.value,
                "test_date": r.test_date.isoformat(),
            }
        )
    return needs_redo


def _compute_recent_activity(db: Session, limit: int = RECENT_ACTIVITY_LIMIT) -> list[AuditLogOut]:
    rows = (
        db.query(AuditLog)
        .options(joinedload(AuditLog.actor))
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return [AuditLogOut.model_validate(r) for r in rows]


def compute_dashboard(db: Session) -> dict:
    emitter_counts, mdf_counts = _compute_status_counts(db)
    sim_rows = _compute_emitter_sim_status(db)
    sim_line_counts = dict.fromkeys(SIM_OUTCOME_KEYS, 0)
    for row in sim_rows:
        for key, count in row["line_outcomes"].items():
            sim_line_counts[key] += count

    return {
        "emitter_status_counts": emitter_counts,
        "mdf_status_counts": mdf_counts,
        "needs_attention": _compute_needs_attention(db, sim_rows),
        "pending_approvals": _compute_pending_approvals(db),
        "sim_line_counts": sim_line_counts,
        "emitter_sim_status": sim_rows,
        "recent_test_runs": _compute_recent_test_runs(db),
        "needs_redo": _compute_needs_redo(db),
        "recent_activity": _compute_recent_activity(db),
    }
