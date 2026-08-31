from datetime import datetime, timedelta, timezone

from sqlalchemy import Date, cast, func
from sqlalchemy.orm import Session, joinedload

from app.core.enums import AuditAction, EmitterStatus, MdfStatus, ModeStatus, SourceStatus, TestResult
from app.models.audit_log import AuditLog
from app.models.emitter import Emitter
from app.models.emitter_version import EmitterVersion
from app.models.ew_group import EwGroup
from app.models.mdf import Mdf
from app.models.mode import Mode
from app.models.source import Source
from app.models.test_record import TestRecord
from app.schemas.audit_log import AuditLogOut
from app.services.emitter_summary_service import compute_emitter_summaries
from app.services.readiness_service import compute_mdf_readiness_warnings

STALE_DRAFT_DAYS = 7
ACTIVITY_TREND_DAYS = 21
RECENT_ACTIVITY_LIMIT = 10


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


def _compute_needs_attention(db: Session) -> list[dict]:
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
            {"message": message, "entity_type": "emitter", "entity_id": str(emitter.id)}
        )

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

    pending_mode_drafts = (
        db.query(Mode, EwGroup.emitter_id, Emitter.name)
        .join(EwGroup, Mode.ew_group_id == EwGroup.id)
        .join(Emitter, EwGroup.emitter_id == Emitter.id)
        .filter(Mode.status == ModeStatus.draft, Emitter.is_deleted.is_(False))
        .all()
    )
    for mode, emitter_id, emitter_name in pending_mode_drafts:
        pending.append(
            {
                "message": f"Mode '{mode.name}' on Emitter '{emitter_name}' has a proposed edit awaiting approval.",
                "kind": "mode",
                "emitter_id": str(emitter_id),
            }
        )

    return pending


def _compute_modes_passing_totals(db: Session) -> tuple[int, int]:
    emitter_ids = [row[0] for row in db.query(Emitter.id).filter(Emitter.is_deleted.is_(False)).all()]
    summaries = compute_emitter_summaries(db, emitter_ids)
    modes_total = sum(s.mode_count for s in summaries.values())
    modes_passing_total = sum(s.modes_passing for s in summaries.values())
    return modes_passing_total, modes_total


def _compute_test_result_counts(db: Session) -> dict[str, int]:
    counts = {r.value: 0 for r in TestResult}
    for result_value, count in db.query(TestRecord.result, func.count()).group_by(TestRecord.result).all():
        counts[result_value.value] = count
    return counts


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

    emitter_ids = {r.scope_id for r in records if r.scope_type.value == "emitter"}
    mdf_ids = {r.scope_id for r in records if r.scope_type.value == "mdf"}
    emitter_names = dict(db.query(Emitter.id, Emitter.name).filter(Emitter.id.in_(emitter_ids)).all())
    mdf_names = dict(db.query(Mdf.id, Mdf.name).filter(Mdf.id.in_(mdf_ids)).all())

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


def compute_activity_trend(db: Session, days: int = ACTIVITY_TREND_DAYS, action: AuditAction | None = None) -> list[dict]:
    today = datetime.now(timezone.utc).date()
    cutoff = datetime.now(timezone.utc) - timedelta(days=days - 1)
    query = db.query(cast(AuditLog.created_at, Date).label("day"), func.count()).filter(
        AuditLog.created_at >= cutoff
    )
    if action is not None:
        query = query.filter(AuditLog.action == action)
    rows = query.group_by("day").all()
    counts_by_day = {day.isoformat(): count for day, count in rows}
    trend = []
    for i in range(days - 1, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        trend.append({"date": d, "count": counts_by_day.get(d, 0)})
    return trend


def compute_dashboard(db: Session) -> dict:
    emitter_counts, mdf_counts = _compute_status_counts(db)
    modes_passing_total, modes_total = _compute_modes_passing_totals(db)

    return {
        "emitter_status_counts": emitter_counts,
        "mdf_status_counts": mdf_counts,
        "needs_attention": _compute_needs_attention(db),
        "pending_approvals": _compute_pending_approvals(db),
        "modes_passing_total": modes_passing_total,
        "modes_total": modes_total,
        "test_result_counts": _compute_test_result_counts(db),
        "needs_redo": _compute_needs_redo(db),
        "recent_activity": _compute_recent_activity(db),
        "activity_trend": compute_activity_trend(db),
    }
