from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.enums import EmitterStatus, MdfStatus
from app.models.emitter import Emitter
from app.models.emitter_version import EmitterVersion
from app.models.mdf import Mdf
from app.services.readiness_service import compute_mdf_readiness_warnings

STALE_DRAFT_DAYS = 7


def compute_dashboard(db: Session) -> dict:
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

    needs_attention: list[str] = []

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
            needs_attention.append(f"Emitter '{emitter.name}' has been in draft with no commit for {days} days.")

    active_mdfs = (
        db.query(Mdf)
        .filter(Mdf.is_deleted.is_(False), Mdf.status.notin_([MdfStatus.released, MdfStatus.deprecated]))
        .all()
    )
    for mdf in active_mdfs:
        warnings = compute_mdf_readiness_warnings(db, mdf)
        for w in warnings:
            needs_attention.append(f"MDF '{mdf.name}': {w}")

    return {
        "emitter_status_counts": emitter_counts,
        "mdf_status_counts": mdf_counts,
        "needs_attention": needs_attention,
    }
