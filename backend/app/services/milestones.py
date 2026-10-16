"""Milestones: what to get done before an Emitter, Platform or MDF reaches
a status. Defaults (set by Admins) are on every item of their type; an item
can have its own too. Ticked by hand, with who, when and a note. Moving to
a status with milestones not met asks to confirm, then records which."""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.status_definition import MilestoneCheck, MilestoneDefinition
from app.models.user import User
from app.services import statuses
from app.services.statuses import StatusNoteRequired, StatusTransitionNotAllowed


def definitions_for(db: Session, entity_type: str, entity_id: uuid.UUID | None) -> list[MilestoneDefinition]:
    """An item's milestones (the defaults and its own), or with no item just
    the defaults — in status order, then their own order."""
    query = db.query(MilestoneDefinition).filter(MilestoneDefinition.entity_type == entity_type)
    if entity_id is None:
        query = query.filter(MilestoneDefinition.entity_id.is_(None))
    else:
        query = query.filter(
            or_(MilestoneDefinition.entity_id.is_(None), MilestoneDefinition.entity_id == entity_id)
        )
    order = {key: i for i, key in enumerate(d.key for d in statuses.definitions(db, entity_type))}
    rows = query.all()
    rows.sort(key=lambda m: (order.get(m.status_key, len(order)), m.entity_id is not None, m.position, m.created_at))
    return rows


def item_milestones(db: Session, entity_type: str, entity_id: uuid.UUID) -> list[dict]:
    defs = definitions_for(db, entity_type, entity_id)
    checks = {
        c.milestone_id: c
        for c in db.query(MilestoneCheck).filter(
            MilestoneCheck.entity_id == entity_id, MilestoneCheck.milestone_id.in_([m.id for m in defs] or [None])
        )
    }
    users = {u.id: u.username for u in db.query(User).filter(User.id.in_([c.done_by for c in checks.values()] or [None]))}
    out = []
    for m in defs:
        c = checks.get(m.id)
        out.append(
            {
                "id": m.id,
                "status_key": m.status_key,
                "title": m.title,
                "description": m.description,
                "is_default": m.entity_id is None,
                "done": c is not None,
                "done_at": c.done_at if c else None,
                "done_by_username": users.get(c.done_by) if c else None,
                "note": c.note if c else None,
            }
        )
    return out


def unmet(db: Session, entity_type: str, entity_id: uuid.UUID, status_key: str) -> list[MilestoneDefinition]:
    defs = [m for m in definitions_for(db, entity_type, entity_id) if m.status_key == status_key]
    if not defs:
        return []
    done = {
        c.milestone_id
        for c in db.query(MilestoneCheck.milestone_id).filter(
            MilestoneCheck.entity_id == entity_id, MilestoneCheck.milestone_id.in_([m.id for m in defs])
        )
    }
    return [m for m in defs if m.id not in done]


def check_status_move(
    db: Session,
    entity_type: str,
    entity_id: uuid.UUID,
    old: str,
    new: str,
    note: str | None,
    confirm_unmet: bool,
) -> tuple[statuses.StatusDefinition, list[str]]:
    """The status moved to and the milestones for it still open — once the
    move is allowed, has its note, and (when milestones are open) has been
    confirmed. Errors as HTTP responses for the status routes."""
    try:
        target = statuses.check_move(db, entity_type, old, new, note)
    except StatusTransitionNotAllowed as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except (StatusNoteRequired, statuses.StatusError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    open_ones = [m.title for m in unmet(db, entity_type, entity_id, new)]
    if open_ones and not confirm_unmet:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {
                "message": f"Not every milestone for {target.label} is met: " + "; ".join(open_ones),
                "status": target.label,
                "unmet_milestones": open_ones,
            },
        )
    return target, open_ones


def unmet_suffix(open_ones: list[str]) -> str:
    return f" (milestones not met: {'; '.join(open_ones)})" if open_ones else ""
