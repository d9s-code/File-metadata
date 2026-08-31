from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_role
from app.models.audit_log import AuditLog
from app.models.emitter import Emitter
from app.models.ew_group import EwGroup
from app.models.mdf import Mdf
from app.models.platform import Platform
from app.models.source import Source
from app.schemas.audit_log import (
    AuditActionCount,
    AuditEntitySearchResult,
    AuditGroupCount,
    AuditLogOut,
    AuditLogPage,
)

router = APIRouter(prefix="/audit-log", tags=["audit-log"])

# The named entities audit history can be scoped to by name (as opposed to
# entity-type category or a raw summary-text substring) — powers the Audit
# Log page's object picker. Ordered roughly by how often you'd search for one.
_SEARCHABLE_ENTITIES = [
    (Emitter, AuditEntityType.emitter),
    (Platform, AuditEntityType.platform),
    (Mdf, AuditEntityType.mdf),
    (EwGroup, AuditEntityType.ew_group),
    (Source, AuditEntityType.source),
]


@router.get("", response_model=AuditLogPage)
def list_audit_log(
    entity_type: str | None = None,
    action: AuditAction | None = None,
    entity_id: UUID | None = None,
    actor_id: UUID | None = None,
    emitter_id: UUID | None = None,
    q: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> AuditLogPage:
    """Chronological audit feed, filterable by entity type/action (the
    "group"/"subgroup" the UI navigates by), a specific entity, actor, free-text
    search over the summary, and a date range. `emitter_id` rolls up every
    entry that belongs anywhere under that Emitter (its own entries plus its
    EW Groups/Sources/Modes/elements/generation batches/imports/test
    records) — combine it with `entity_type`/`action` to narrow within that
    rollup rather than to one exact entity.
    """
    query = db.query(AuditLog).options(joinedload(AuditLog.actor))
    if entity_type:
        query = query.filter(AuditLog.entity_type == entity_type)
    if action:
        query = query.filter(AuditLog.action == action)
    if entity_id:
        query = query.filter(AuditLog.entity_id == entity_id)
    if actor_id:
        query = query.filter(AuditLog.actor_id == actor_id)
    if emitter_id:
        query = query.filter(AuditLog.emitter_id == emitter_id)
    if q:
        query = query.filter(AuditLog.summary.ilike(f"%{q}%"))
    if since:
        query = query.filter(AuditLog.created_at >= since)
    if until:
        query = query.filter(AuditLog.created_at <= until)

    total = query.count()
    items = query.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit).all()
    return AuditLogPage(items=items, total=total)


@router.get("/entities", response_model=list[AuditEntitySearchResult])
def search_audit_entities(
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> list[AuditEntitySearchResult]:
    """Name search across Emitters/Platforms/MDFs/EW Groups/Sources — lets the
    Audit Log page filter to "everything that happened to this specific
    object" precisely (by id), rather than only a category or a
    summary-text substring that can miss entries (e.g. a Mode's summary
    doesn't mention its parent Emitter's name).
    """
    like = f"%{q}%"
    results: list[AuditEntitySearchResult] = []
    for model, entity_type in _SEARCHABLE_ENTITIES:
        rows = db.query(model.id, model.name).filter(model.name.ilike(like)).order_by(model.name).limit(8).all()
        results.extend(
            AuditEntitySearchResult(entity_type=entity_type.value, entity_id=row_id, name=name)
            for row_id, name in rows
        )
    return results


@router.get("/entity-types", response_model=list[AuditGroupCount])
def list_entity_type_counts(db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> list[AuditGroupCount]:
    """Every entity type that has at least one entry, with its count — the
    top-level "group" list the UI navigates by. Seeded from the full
    AuditEntityType enum (zero-count groups included) so the group list
    doesn't shift as the log fills in.
    """
    counts = dict(
        db.query(AuditLog.entity_type, func.count()).group_by(AuditLog.entity_type).all()
    )
    return [
        AuditGroupCount(entity_type=t.value, count=counts.get(t.value, 0))
        for t in AuditEntityType
    ]


@router.get("/actions", response_model=list[AuditActionCount])
def list_action_counts(
    entity_type: str | None = None,
    entity_id: UUID | None = None,
    emitter_id: UUID | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> list[AuditActionCount]:
    """Action breakdown (the "subgroup" list) — optionally scoped to one
    entity type (or one specific entity), or rolled up across everything
    under one Emitter via `emitter_id`, so the counts reflect the group
    the UI has drilled into.
    """
    query = db.query(AuditLog.action, func.count())
    if entity_type:
        query = query.filter(AuditLog.entity_type == entity_type)
    if entity_id:
        query = query.filter(AuditLog.entity_id == entity_id)
    if emitter_id:
        query = query.filter(AuditLog.emitter_id == emitter_id)
    counts = dict(query.group_by(AuditLog.action).all())
    return [AuditActionCount(action=a, count=counts.get(a.value, 0)) for a in AuditAction]
