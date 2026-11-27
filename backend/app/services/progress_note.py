"""What a progress note shows about an MDF still being worked on: its goals
(done or not), its Progress log entries since its last release (all of them
before it has one), and per Platform how far the Emitters it carries are
towards Operational.

Goals and the log are as they are now. The Platforms and their Emitters are
those of the saved version the note is of; each Emitter's status is its
status now (a status move saves no version)."""

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import AuditAction, AuditEntityType
from app.models.audit_log import AuditLog
from app.models.emitter import Emitter
from app.models.mdf_plan import MdfGoal, MdfLogEntry
from app.services import statuses


def last_release_at(db: Session, mdf_id: uuid.UUID) -> datetime | None:
    """When the MDF last moved to Released."""
    moves = db.scalars(
        select(AuditLog)
        .where(AuditLog.entity_id == mdf_id, AuditLog.entity_type == AuditEntityType.mdf.value, AuditLog.action == AuditAction.status_change)
        .order_by(AuditLog.created_at)
    ).all()
    released = [m.created_at for m in moves if ((m.changes or {}).get("status") or {}).get("new") == "released"]
    return released[-1] if released else None


def goals(db: Session, mdf_id: uuid.UUID) -> list[dict]:
    rows = db.scalars(select(MdfGoal).where(MdfGoal.mdf_id == mdf_id).order_by(MdfGoal.position, MdfGoal.created_at)).all()
    return [
        {"text": g.text, "done": g.done_at is not None, "done_at": g.done_at, "note": g.done_note, "by": g.doer.username if g.doer else None}
        for g in rows
    ]


def progress_log(db: Session, mdf_id: uuid.UUID, since: datetime | None) -> list[dict]:
    """The Progress entries since `since` (all, when None), newest first."""
    q = select(MdfLogEntry).where(MdfLogEntry.mdf_id == mdf_id, MdfLogEntry.kind == "progress")
    if since is not None:
        q = q.where(MdfLogEntry.created_at > since)
    rows = db.scalars(q.order_by(MdfLogEntry.created_at.desc())).all()
    return [{"at": e.created_at, "by": e.author.username if e.author else None, "text": e.body} for e in rows]


def emitter_progress(db: Session, snapshot: dict) -> dict:
    """Per Platform of an MDF version: how many Emitters it carries, how far
    they are towards Operational on average (0–100), and how many are in
    each status — with the same over every Emitter once ("overall")."""
    links = snapshot.get("links", [])
    ids = {
        uuid.UUID(e["emitter_id"])
        for link in links
        for e in (link.get("platform_snapshot") or {}).get("links", [])
    }
    now = {str(i): s for i, s in db.execute(select(Emitter.id, Emitter.status).where(Emitter.id.in_(ids))).all()} if ids else {}
    weights = statuses.emitter_progress_weights(db)
    defs = statuses.definitions(db, "emitter")
    labels = {d.key: d.label for d in defs}
    order = [d.key for d in defs]

    def summed(emitter_ids: list[str]) -> dict:
        counted = [now[e] for e in emitter_ids if e in now]
        counts: dict[str, int] = {}
        for s in counted:
            counts[s] = counts.get(s, 0) + 1
        by_status = " · ".join(
            f"{counts[k]} {labels.get(k, k)}" for k in sorted(counts, key=lambda k: order.index(k) if k in order else len(order))
        )
        percent = round(100 * sum(weights.get(s, 0.0) for s in counted) / len(counted)) if counted else None
        return {"emitters": len(counted), "percent": percent, "by_status": by_status or "—"}

    platforms = []
    for link in sorted(links, key=lambda link: link["platform_name"].lower()):
        emitters = [e["emitter_id"] for e in (link.get("platform_snapshot") or {}).get("links", [])]
        platforms.append({"platform": link["platform_name"], **summed(emitters)})
    return {"platforms": platforms, "overall": summed(sorted({str(i) for i in ids}))}


def progress_data(db: Session, mdf_id: uuid.UUID, snapshot: dict) -> dict:
    since = last_release_at(db, mdf_id)
    return {
        "since": since,
        "goals": goals(db, mdf_id),
        "log": progress_log(db, mdf_id, since),
        "emitter_progress": emitter_progress(db, snapshot),
    }
