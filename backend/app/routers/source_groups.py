from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_role
from app.models.emitter import Emitter
from app.models.mode import Mode, ModeElement
from app.models.parameter_sequence import ParameterSequence
from app.models.source import Source
from app.models.source_group import SourceGroup
from app.schemas.source_group import SourceGroupCreate, SourceGroupOut, SourceGroupUpdate, SourceOverviewOut
from app.services.audit_service import apply_and_diff, record_audit, snapshot
from app.services.source_group_service import compute_source_group_stats

router = APIRouter(prefix="/source-groups", tags=["source_groups"])


def _get_source_group_or_404(db: Session, group_id: UUID) -> SourceGroup:
    group = db.get(SourceGroup, group_id)
    if group is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source group not found")
    return group


def _to_out(group: SourceGroup) -> SourceGroupOut:
    stats = compute_source_group_stats(group)
    out = SourceGroupOut.model_validate(group)
    out.source_count = stats.source_count
    out.last_updated_source_date = stats.last_updated_source_date
    out.last_edited_at = stats.last_edited_at
    out.rf_min_mhz = stats.rf_min_mhz
    out.rf_max_mhz = stats.rf_max_mhz
    out.pw_min_us = stats.pw_min_us
    out.pw_max_us = stats.pw_max_us
    out.pri_min_us = stats.pri_min_us
    out.pri_max_us = stats.pri_max_us
    out.pri_stagger_count = stats.pri_stagger_count
    return out


@router.get("/", response_model=list[SourceGroupOut])
def list_source_groups(db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> list[SourceGroupOut]:
    """Lists all source groups, with derived stats rolled up across each group's Sources."""
    groups = db.query(SourceGroup).order_by(SourceGroup.name).all()
    return [_to_out(g) for g in groups]


@router.get("/sources", response_model=list[SourceOverviewOut])
def list_sources_overview(db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> list[SourceOverviewOut]:
    """Every Source on a live Emitter, grouped or not, with its group, its
    Emitter, its dates and how much it holds — what the Source Groups page
    builds its tree and queries from. Declared before /{group_id}."""

    def count_by_source(model):
        return dict(db.query(model.source_id, func.count(model.id)).group_by(model.source_id).all())

    elements = count_by_source(ModeElement)
    sequences = count_by_source(ParameterSequence)
    modes = count_by_source(Mode)
    rows = (
        db.query(Source, Emitter, SourceGroup)
        .join(Emitter, Emitter.id == Source.emitter_id)
        .outerjoin(SourceGroup, SourceGroup.id == Source.group_id)
        .filter(Emitter.is_deleted.is_(False))
        .order_by(SourceGroup.name.nulls_last(), Emitter.name, Source.name)
        .all()
    )
    return [
        SourceOverviewOut(
            id=s.id,
            name=s.name,
            status=s.status.value if hasattr(s.status, "value") else str(s.status),
            source_type=s.source_type,
            source_date=s.source_date,
            updated_at=s.updated_at,
            group_id=g.id if g else None,
            group_name=g.name if g else None,
            emitter_id=e.id,
            emitter_name=e.name,
            emitter_designation=e.designation,
            element_count=elements.get(s.id, 0),
            sequence_count=sequences.get(s.id, 0),
            mode_count=modes.get(s.id, 0),
        )
        for s, e, g in rows
    ]


@router.post("/", response_model=SourceGroupOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
def create_source_group(
    source_group: SourceGroupCreate, db: Session = Depends(get_db), user=Depends(require_role(Role.admin))
) -> SourceGroupOut:
    """Creates a new source group."""
    db_group = SourceGroup(**source_group.model_dump())
    db.add(db_group)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.source_group.value,
        entity_id=db_group.id,
        summary=f"Created Source Group '{db_group.name}'",
        changes=source_group.model_dump(mode="json"),
    )
    db.commit()
    db.refresh(db_group)
    return _to_out(db_group)


@router.get("/{group_id}", response_model=SourceGroupOut)
def get_source_group(
    group_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> SourceGroupOut:
    """Gets a specific source group by ID."""
    return _to_out(_get_source_group_or_404(db, group_id))


@router.patch("/{group_id}", response_model=SourceGroupOut, dependencies=[Depends(verify_csrf)])
def update_source_group(
    group_id: UUID,
    source_group_update: SourceGroupUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.admin)),
) -> SourceGroupOut:
    """Updates an existing source group."""
    db_group = _get_source_group_or_404(db, group_id)
    changes = apply_and_diff(db_group, source_group_update.model_dump(exclude_unset=True))
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.source_group.value,
        entity_id=db_group.id,
        summary=f"Updated Source Group '{db_group.name}'",
        changes=changes,
    )
    db.commit()
    db.refresh(db_group)
    return _to_out(db_group)


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_source_group(
    group_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.admin))
) -> None:
    """Deletes a source group. Sources in this group have their group_id set to NULL."""
    db_group = _get_source_group_or_404(db, group_id)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.source_group.value,
        entity_id=db_group.id,
        summary=f"Deleted Source Group '{db_group.name}'",
        changes=snapshot(db_group, ["name", "description"]),
    )
    db.delete(db_group)
    db.commit()
