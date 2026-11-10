"""Threat priorities across every Emitter: one row per EW Group (where the
priority lives — the PRS XML's ThreatPriority), with its Emitter, the
Platforms that pin it and their allegiance, and a bulk change.

A change follows the usual editing rules: the Emitter must be checked out
by you. One nobody holds is checked out to you on the way (start_editing),
as Start editing would; one someone else holds can't be changed. The new
priorities are unsaved changes until each Emitter's version is saved."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_role
from app.models.emitter import Emitter
from app.models.ew_group import EwGroup
from app.models.mode import Mode
from app.models.platform import Platform, PlatformEmitterLink
from app.models.user import User
from app.services import checkout_service
from app.services.audit_service import apply_and_diff, record_audit

router = APIRouter(prefix="/threat-priorities", tags=["threat-priorities"])


class PlatformRef(BaseModel):
    id: UUID
    name: str
    allegiance: str | None


class ThreatPriorityRow(BaseModel):
    ew_group_id: UUID
    ew_group_name: str
    threat_priority: int | None
    ageout: float | None
    modes_count: int
    emitter_id: UUID
    emitter_name: str
    designation: str | None
    emitter_status: str
    checked_out_by_id: UUID | None
    checked_out_by_username: str | None
    platforms: list[PlatformRef]


class PriorityChange(BaseModel):
    ew_group_id: UUID
    # None clears it.
    threat_priority: int | None = Field(default=None, ge=0, le=1_000_000)


class PriorityChanges(BaseModel):
    changes: list[PriorityChange] = Field(min_length=1, max_length=5_000)
    # Check out, to you, an Emitter nobody is editing.
    start_editing: bool = True


class PriorityChangeResult(BaseModel):
    updated: int
    unchanged: int
    # Emitters checked out to you by this change.
    started_editing: list[str]


@router.get("", response_model=list[ThreatPriorityRow])
def list_threat_priorities(db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> list[ThreatPriorityRow]:
    modes = dict(db.query(Mode.ew_group_id, func.count(Mode.id)).group_by(Mode.ew_group_id).all())
    pins: dict[UUID, list[PlatformRef]] = {}
    for link, platform in (
        db.query(PlatformEmitterLink, Platform)
        .join(Platform, Platform.id == PlatformEmitterLink.platform_id)
        .filter(Platform.is_deleted.is_(False))
        .order_by(func.lower(Platform.name))
    ):
        pins.setdefault(link.emitter_id, []).append(PlatformRef(id=platform.id, name=platform.name, allegiance=platform.allegiance))
    rows = (
        db.query(EwGroup, Emitter, User.username)
        .join(Emitter, Emitter.id == EwGroup.emitter_id)
        .outerjoin(User, User.id == Emitter.checked_out_by_id)
        .filter(Emitter.is_deleted.is_(False))
        .order_by(func.lower(Emitter.name), EwGroup.sort_order, func.lower(EwGroup.name))
        .all()
    )
    return [
        ThreatPriorityRow(
            ew_group_id=g.id,
            ew_group_name=g.name,
            threat_priority=g.threat_priority,
            ageout=float(g.ageout) if g.ageout is not None else None,
            modes_count=modes.get(g.id, 0),
            emitter_id=e.id,
            emitter_name=e.name,
            designation=e.designation,
            emitter_status=e.status,
            checked_out_by_id=e.checked_out_by_id,
            checked_out_by_username=holder,
            platforms=pins.get(e.id, []),
        )
        for g, e, holder in rows
    ]


@router.post("", response_model=PriorityChangeResult, dependencies=[Depends(verify_csrf)])
def change_threat_priorities(
    payload: PriorityChanges, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> PriorityChangeResult:
    """All or none: refused if any EW Group is gone, or its Emitter is held by
    someone else (or by nobody, without start_editing)."""
    wanted = {c.ew_group_id: c.threat_priority for c in payload.changes}
    groups = db.query(EwGroup).filter(EwGroup.id.in_(wanted)).all()
    if len(groups) != len(wanted):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "An EW Group isn't there any more — reload the list")
    emitter_ids = {g.emitter_id for g in groups}
    # Locked, so two people can't both claim a free Emitter here.
    emitters = {
        e.id: e
        for e in db.query(Emitter).filter(Emitter.id.in_(emitter_ids)).with_for_update().populate_existing().all()
    }
    blocked = [
        e.name
        for e in emitters.values()
        if e.is_deleted
        or (e.checked_out_by_id is not None and e.checked_out_by_id != user.id)
        or (e.checked_out_by_id is None and not payload.start_editing)
    ]
    if blocked:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Can't change these now — someone else is editing them (or they're deleted): {', '.join(sorted(blocked))}",
        )
    started: list[str] = []
    for e in sorted(emitters.values(), key=lambda x: x.name.lower()):
        if e.checked_out_by_id is None:
            checkout_service.start_checkout(e, user.id)
            started.append(e.name)
            record_audit(
                db,
                actor_id=user.id,
                action=AuditAction.checkout,
                entity_type=AuditEntityType.emitter.value,
                entity_id=e.id,
                summary=f"Started editing Emitter '{e.name}' (to change threat priorities)",
                emitter_id=e.id,
            )
    updated = 0
    for g in groups:
        changes = apply_and_diff(g, {"threat_priority": wanted[g.id]})
        if not changes:
            continue
        updated += 1
        record_audit(
            db,
            actor_id=user.id,
            action=AuditAction.update,
            entity_type=AuditEntityType.ew_group.value,
            entity_id=g.id,
            summary=f"Updated EW Group '{g.name}' (threat priority, from the overview)",
            changes=changes,
            emitter_id=g.emitter_id,
        )
    db.commit()
    return PriorityChangeResult(updated=updated, unchanged=len(groups) - updated, started_editing=started)
