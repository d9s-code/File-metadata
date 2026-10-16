"""Statuses and milestones: what Admins set up for each kind of item
(Emitter, Platform, MDF), and each item's milestones ticked off."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import has_role, require_role
from app.models.emitter import Emitter
from app.models.mdf import Mdf
from app.models.platform import Platform
from app.models.status_definition import MilestoneCheck, MilestoneDefinition, StatusDefinition
from app.schemas.statuses import (
    EntityType,
    ItemMilestoneOut,
    MilestoneCheckIn,
    MilestoneCreate,
    MilestoneDefaultCreate,
    MilestoneDefinitionOut,
    MilestoneReorder,
    MilestoneUpdate,
    StatusDefinitionCreate,
    StatusDefinitionOut,
    StatusDefinitionUpdate,
    StatusReorder,
)
from app.services import milestones, statuses
from app.services.audit_service import record_audit

router = APIRouter(tags=["statuses"])

_MODELS = {"emitter": Emitter, "platform": Platform, "mdf": Mdf}
_NOUN = {"emitter": "Emitter", "platform": "Platform", "mdf": "MDF"}


def _in_use(db: Session, entity_type: str) -> dict[str, int]:
    model = _MODELS[entity_type]
    return dict(
        db.query(model.status, func.count()).filter(model.is_deleted.is_(False)).group_by(model.status).all()
    )


def _out(db: Session, defs: list[StatusDefinition]) -> list[StatusDefinitionOut]:
    counts: dict[str, dict[str, int]] = {}
    out = []
    for d in defs:
        if d.entity_type not in counts:
            counts[d.entity_type] = _in_use(db, d.entity_type)
        out.append(StatusDefinitionOut.model_validate(d).model_copy(update={"in_use": counts[d.entity_type].get(d.key, 0)}))
    return out


def _audit(db: Session, user, summary: str, entity_id=None, entity_type=AuditEntityType.status_definition, **kw) -> None:
    record_audit(
        db,
        actor_id=user.id,
        action=kw.pop("action", AuditAction.update),
        entity_type=entity_type.value,
        entity_id=entity_id,
        summary=summary,
        **kw,
    )


# --- Statuses ---------------------------------------------------------------


@router.get("/statuses", response_model=list[StatusDefinitionOut])
def list_statuses(db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> list[StatusDefinitionOut]:
    defs = [d for t in statuses.ENTITY_TYPES for d in statuses.definitions(db, t)]
    db.commit()  # Keeps the built-ins written on first read.
    return _out(db, defs)


@router.post(
    "/statuses", response_model=StatusDefinitionOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)]
)
def create_status(
    payload: StatusDefinitionCreate, db: Session = Depends(get_db), user=Depends(require_role(Role.admin))
) -> StatusDefinitionOut:
    existing = statuses.definitions(db, payload.entity_type)
    if any(d.label.lower() == payload.label.lower() for d in existing):
        raise HTTPException(status.HTTP_409_CONFLICT, f"There's already a status called '{payload.label}'")
    d = StatusDefinition(
        entity_type=payload.entity_type,
        key=statuses.new_key(db, payload.entity_type, payload.label),
        label=payload.label,
        color=payload.color,
        position=max((x.position for x in existing), default=-1) + 1,
        builtin=False,
        transitions=[],
        requires_note=False,
    )
    db.add(d)
    db.flush()
    _audit(
        db, user, f"Added {_NOUN[d.entity_type]} status '{d.label}'", d.id, action=AuditAction.create
    )
    db.commit()
    return _out(db, [d])[0]


def _get_status(db: Session, status_id: UUID) -> StatusDefinition:
    d = db.get(StatusDefinition, status_id)
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Status not found")
    return d


@router.patch("/statuses/{status_id}", response_model=StatusDefinitionOut, dependencies=[Depends(verify_csrf)])
def update_status(
    status_id: UUID, payload: StatusDefinitionUpdate, db: Session = Depends(get_db), user=Depends(require_role(Role.admin))
) -> StatusDefinitionOut:
    d = _get_status(db, status_id)
    siblings = statuses.by_key(db, d.entity_type)
    changes = []
    if payload.label is not None and payload.label != d.label:
        if any(s.label.lower() == payload.label.lower() and s.id != d.id for s in siblings.values()):
            raise HTTPException(status.HTTP_409_CONFLICT, f"There's already a status called '{payload.label}'")
        changes.append(f"renamed from '{d.label}'")
        d.label = payload.label
    if payload.color is not None and payload.color != d.color:
        changes.append(f"colour {d.color} → {payload.color}")
        d.color = payload.color
    if payload.transitions is not None:
        unknown = [k for k in payload.transitions if k not in siblings]
        if unknown:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown status(es): {', '.join(unknown)}")
        moves = [k for k in dict.fromkeys(payload.transitions) if k != d.key]
        if moves != list(d.transitions):
            changes.append("can move to: " + (", ".join(siblings[k].label for k in moves) or "nothing"))
            d.transitions = moves
    if payload.requires_note is not None and payload.requires_note != d.requires_note:
        changes.append("asks for a note" if payload.requires_note else "no longer asks for a note")
        d.requires_note = payload.requires_note
    if payload.note_prompt is not None and (payload.note_prompt.strip() or None) != d.note_prompt:
        d.note_prompt = payload.note_prompt.strip() or None
        changes.append("note prompt changed")
    if changes:
        _audit(db, user, f"{_NOUN[d.entity_type]} status '{d.label}': " + "; ".join(changes), d.id)
    db.commit()
    return _out(db, [d])[0]


@router.post("/statuses/reorder", response_model=list[StatusDefinitionOut], dependencies=[Depends(verify_csrf)])
def reorder_statuses(
    payload: StatusReorder, db: Session = Depends(get_db), user=Depends(require_role(Role.admin))
) -> list[StatusDefinitionOut]:
    defs = {d.id: d for d in statuses.definitions(db, payload.entity_type)}
    if set(payload.ids) != set(defs):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Give every status of the type, once each")
    for i, status_id in enumerate(payload.ids):
        defs[status_id].position = i
    _audit(
        db,
        user,
        f"Reordered {_NOUN[payload.entity_type]} statuses: " + " → ".join(defs[i].label for i in payload.ids),
    )
    db.commit()
    return _out(db, statuses.definitions(db, payload.entity_type))


@router.delete("/statuses/{status_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_status(status_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.admin))) -> None:
    d = _get_status(db, status_id)
    if d.builtin:
        raise HTTPException(status.HTTP_409_CONFLICT, f"'{d.label}' is built in — it can be renamed, not deleted")
    used = _in_use(db, d.entity_type).get(d.key, 0)
    if used:
        noun = _NOUN[d.entity_type] + ("s" if used != 1 else "")
        raise HTTPException(status.HTTP_409_CONFLICT, f"{used} {noun} {'are' if used != 1 else 'is'} {d.label} — move them first")
    for other in statuses.definitions(db, d.entity_type):
        if d.key in other.transitions:
            other.transitions = [k for k in other.transitions if k != d.key]
    db.query(MilestoneDefinition).filter(
        MilestoneDefinition.entity_type == d.entity_type, MilestoneDefinition.status_key == d.key
    ).delete(synchronize_session=False)
    _audit(db, user, f"Deleted {_NOUN[d.entity_type]} status '{d.label}'", d.id, action=AuditAction.delete)
    db.delete(d)
    db.commit()


# --- Milestones: defaults (Admins) -----------------------------------------


def _check_status_key(db: Session, entity_type: str, key: str) -> None:
    if key not in statuses.by_key(db, entity_type):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown status '{key}'")


def _check_unique_title(db: Session, entity_type: str, entity_id: UUID | None, key: str, title: str) -> None:
    """No two milestones of the same title before the same status on an item."""
    same = [
        m
        for m in milestones.definitions_for(db, entity_type, entity_id)
        if m.status_key == key and m.title.strip().lower() == title.strip().lower()
    ]
    if same:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"There's already a milestone '{title}' before {statuses.label(db, entity_type, key)}",
        )


def _next_position(db: Session, entity_type: str, entity_id: UUID | None, key: str) -> int:
    q = db.query(func.max(MilestoneDefinition.position)).filter(
        MilestoneDefinition.entity_type == entity_type, MilestoneDefinition.status_key == key
    )
    q = q.filter(MilestoneDefinition.entity_id.is_(None) if entity_id is None else MilestoneDefinition.entity_id == entity_id)
    return (q.scalar() or 0) + 1


@router.get("/milestones/defaults", response_model=list[MilestoneDefinitionOut])
def list_default_milestones(
    entity_type: EntityType, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[MilestoneDefinition]:
    return milestones.definitions_for(db, entity_type, None)


@router.post(
    "/milestones/defaults",
    response_model=MilestoneDefinitionOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def create_default_milestone(
    payload: MilestoneDefaultCreate, db: Session = Depends(get_db), user=Depends(require_role(Role.admin))
) -> MilestoneDefinition:
    _check_status_key(db, payload.entity_type, payload.status_key)
    _check_unique_title(db, payload.entity_type, None, payload.status_key, payload.title)
    m = MilestoneDefinition(
        entity_type=payload.entity_type,
        entity_id=None,
        status_key=payload.status_key,
        title=payload.title,
        description=(payload.description or "").strip() or None,
        position=_next_position(db, payload.entity_type, None, payload.status_key),
        created_by=user.id,
    )
    db.add(m)
    db.flush()
    _audit(
        db,
        user,
        f"Added default {_NOUN[m.entity_type]} milestone '{m.title}' for "
        f"{statuses.label(db, m.entity_type, m.status_key)}",
        m.id,
        entity_type=AuditEntityType.milestone,
        action=AuditAction.create,
    )
    db.commit()
    return m


# --- Milestones: an item's ---------------------------------------------------


def _get_item(db: Session, entity_type: str, entity_id: UUID):
    model = _MODELS.get(entity_type)
    if model is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown item type")
    item = db.get(model, entity_id)
    if item is None or item.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{_NOUN[entity_type]} not found")
    return item


def _item_audit(db: Session, user, entity_type: str, item, summary: str) -> None:
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=entity_type,
        entity_id=item.id,
        summary=f"{_NOUN[entity_type]} '{item.name}': {summary}",
        emitter_id=item.id if entity_type == "emitter" else None,
    )


@router.get("/milestones/{entity_type}/{entity_id}", response_model=list[ItemMilestoneOut])
def list_item_milestones(
    entity_type: EntityType, entity_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[dict]:
    _get_item(db, entity_type, entity_id)
    return milestones.item_milestones(db, entity_type, entity_id)


@router.post(
    "/milestones/{entity_type}/{entity_id}",
    response_model=list[ItemMilestoneOut],
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def create_item_milestone(
    entity_type: EntityType,
    entity_id: UUID,
    payload: MilestoneCreate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> list[dict]:
    item = _get_item(db, entity_type, entity_id)
    _check_status_key(db, entity_type, payload.status_key)
    _check_unique_title(db, entity_type, entity_id, payload.status_key, payload.title)
    m = MilestoneDefinition(
        entity_type=entity_type,
        entity_id=entity_id,
        status_key=payload.status_key,
        title=payload.title,
        description=(payload.description or "").strip() or None,
        position=_next_position(db, entity_type, entity_id, payload.status_key),
        created_by=user.id,
    )
    db.add(m)
    _item_audit(
        db, user, entity_type, item, f"added milestone '{m.title}' for {statuses.label(db, entity_type, m.status_key)}"
    )
    db.commit()
    return milestones.item_milestones(db, entity_type, entity_id)


@router.put(
    "/milestones/{milestone_id}/check/{entity_id}",
    response_model=list[ItemMilestoneOut],
    dependencies=[Depends(verify_csrf)],
)
def tick_milestone(
    milestone_id: UUID,
    entity_id: UUID,
    payload: MilestoneCheckIn,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> list[dict]:
    m = _get_milestone(db, milestone_id)
    item = _get_item(db, m.entity_type, entity_id)
    if m.entity_id is not None and m.entity_id != entity_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Milestone not found on this item")
    check = db.query(MilestoneCheck).filter_by(milestone_id=m.id, entity_id=entity_id).first()
    note = (payload.note or "").strip() or None
    if check is None:
        db.add(MilestoneCheck(milestone_id=m.id, entity_id=entity_id, note=note, done_by=user.id))
        _item_audit(db, user, m.entity_type, item, f"milestone '{m.title}' met" + (f" — {note}" if note else ""))
    elif check.note != note:
        check.note = note
        _item_audit(db, user, m.entity_type, item, f"note on milestone '{m.title}': {note or '(removed)'}")
    db.commit()
    return milestones.item_milestones(db, m.entity_type, entity_id)


@router.delete(
    "/milestones/{milestone_id}/check/{entity_id}",
    response_model=list[ItemMilestoneOut],
    dependencies=[Depends(verify_csrf)],
)
def untick_milestone(
    milestone_id: UUID, entity_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> list[dict]:
    m = _get_milestone(db, milestone_id)
    item = _get_item(db, m.entity_type, entity_id)
    check = db.query(MilestoneCheck).filter_by(milestone_id=m.id, entity_id=entity_id).first()
    if check is not None:
        db.delete(check)
        _item_audit(db, user, m.entity_type, item, f"milestone '{m.title}' no longer met")
    db.commit()
    return milestones.item_milestones(db, m.entity_type, entity_id)


# --- Milestones: change or remove (defaults: Admins; an item's: Editors) ---


def _get_milestone(db: Session, milestone_id: UUID) -> MilestoneDefinition:
    m = db.get(MilestoneDefinition, milestone_id)
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Milestone not found")
    return m


def _may_change(m: MilestoneDefinition, user) -> None:
    if m.entity_id is None and not has_role(user, Role.admin):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Default milestones are changed by Admins, under Admin")


@router.patch("/milestones/{milestone_id}", response_model=MilestoneDefinitionOut, dependencies=[Depends(verify_csrf)])
def update_milestone(
    milestone_id: UUID, payload: MilestoneUpdate, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> MilestoneDefinition:
    m = _get_milestone(db, milestone_id)
    _may_change(m, user)
    if payload.status_key is not None and payload.status_key != m.status_key:
        _check_status_key(db, m.entity_type, payload.status_key)
        m.status_key = payload.status_key
        m.position = _next_position(db, m.entity_type, m.entity_id, payload.status_key)
    if payload.title is not None:
        m.title = payload.title
    if payload.description is not None:
        m.description = payload.description.strip() or None
    summary = f"Changed {'default ' if m.entity_id is None else ''}{_NOUN[m.entity_type]} milestone '{m.title}'"
    _audit(db, user, summary, m.id, entity_type=AuditEntityType.milestone)
    db.commit()
    return m


@router.post("/milestones/reorder", response_model=list[MilestoneDefinitionOut], dependencies=[Depends(verify_csrf)])
def reorder_milestones(
    payload: MilestoneReorder, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> list[MilestoneDefinition]:
    rows = {m.id: m for m in db.query(MilestoneDefinition).filter(MilestoneDefinition.id.in_(payload.ids))}
    if len(rows) != len(set(payload.ids)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Milestone not found")
    for m in rows.values():
        _may_change(m, user)
    for i, mid in enumerate(payload.ids):
        rows[mid].position = i
    db.commit()
    return [rows[i] for i in payload.ids]


@router.delete("/milestones/{milestone_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_milestone(milestone_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))) -> None:
    m = _get_milestone(db, milestone_id)
    _may_change(m, user)
    _audit(
        db,
        user,
        f"Deleted {'default ' if m.entity_id is None else ''}{_NOUN[m.entity_type]} milestone '{m.title}'",
        m.id,
        entity_type=AuditEntityType.milestone,
        action=AuditAction.delete,
    )
    db.delete(m)
    db.commit()
