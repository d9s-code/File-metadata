from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import EMITTER_STATUS_TRANSITIONS, AuditAction, AuditEntityType, EmitterStatus, Role
from app.database import get_db
from app.deps import require_role
from app.models.emitter import Emitter
from app.models.emitter_version import EmitterVersion
from app.models.ew_group import EwGroup
from app.models.mode import Mode, ModeGenerationBatch
from app.schemas.emitter import EmitterCreate, EmitterOut, EmitterUpdate
from app.schemas.mode import ModeGenerationBatchOut, ModeOut
from app.schemas.emitter_version import (
    CommitVersionRequest,
    DiffOut,
    EmitterVersionDetailOut,
    EmitterVersionOut,
    StatusTransitionRequest,
)
from app.services.audit_service import record_audit
from app.services.mode_test_status_service import get_last_test_status
from app.services.snapshots import build_emitter_snapshot
from app.services.status_service import InvalidStatusTransition, validate_transition
from app.services.versioning_service import VersionSpec, commit_version, diff_versions, get_version, list_versions

router = APIRouter(prefix="/emitters", tags=["emitters"])

_VERSION_SPEC = VersionSpec(version_model=EmitterVersion, entity_fk_field="emitter_id")


@router.get("", response_model=list[EmitterOut])
def list_emitters(
    include_deleted: bool = False,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> list[Emitter]:
    q = db.query(Emitter)
    if not include_deleted:
        q = q.filter(Emitter.is_deleted.is_(False))
    return q.order_by(Emitter.name).all()


@router.get("/{emitter_id}", response_model=EmitterOut)
def get_emitter(
    emitter_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> Emitter:
    emitter = db.get(Emitter, emitter_id)
    if emitter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    return emitter


@router.post(
    "",
    response_model=EmitterOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def create_emitter(
    payload: EmitterCreate, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> Emitter:
    if db.query(Emitter).filter(Emitter.name == payload.name).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Emitter name already exists")
    emitter = Emitter(
        name=payload.name,
        designation=payload.designation,
        description=payload.description,
        created_by=user.id,
    )
    db.add(emitter)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.emitter.value,
        entity_id=emitter.id,
        summary=f"Created Emitter '{emitter.name}'",
        changes=payload.model_dump(mode="json"),
    )
    db.commit()
    db.refresh(emitter)
    return emitter


@router.patch("/{emitter_id}", response_model=EmitterOut, dependencies=[Depends(verify_csrf)])
def update_emitter(
    emitter_id: UUID,
    payload: EmitterUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> Emitter:
    emitter = db.get(Emitter, emitter_id)
    if emitter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(emitter, field, value)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.emitter.value,
        entity_id=emitter.id,
        summary=f"Updated Emitter '{emitter.name}'",
        changes=payload.model_dump(exclude_unset=True, mode="json"),
    )
    db.commit()
    db.refresh(emitter)
    return emitter


@router.delete("/{emitter_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_emitter(
    emitter_id: UUID,
    hard: bool = False,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> None:
    emitter = db.get(Emitter, emitter_id)
    if emitter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    if hard:
        if user.role != Role.admin:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Hard delete requires admin role")
        record_audit(
            db,
            actor_id=user.id,
            action=AuditAction.delete,
            entity_type=AuditEntityType.emitter.value,
            entity_id=emitter.id,
            summary=f"Hard-deleted Emitter '{emitter.name}'",
        )
        db.delete(emitter)
    else:
        emitter.is_deleted = True
        record_audit(
            db,
            actor_id=user.id,
            action=AuditAction.delete,
            entity_type=AuditEntityType.emitter.value,
            entity_id=emitter.id,
            summary=f"Deleted Emitter '{emitter.name}'",
        )
    db.commit()


def _get_emitter_or_404(db: Session, emitter_id: UUID) -> Emitter:
    emitter = db.get(Emitter, emitter_id)
    if emitter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    return emitter


@router.get("/{emitter_id}/modes", response_model=list[ModeOut])
def list_emitter_modes(
    emitter_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[ModeOut]:
    """All Modes across every EW Group belonging to this Emitter, in one flat
    list — this is the Emitter's mode overview, so each Mode carries its
    computed last-tested status alongside its parameters.
    """
    _get_emitter_or_404(db, emitter_id)
    modes = (
        db.query(Mode)
        .join(EwGroup, Mode.ew_group_id == EwGroup.id)
        .filter(EwGroup.emitter_id == emitter_id)
        .order_by(EwGroup.sort_order, Mode.sort_order)
        .all()
    )
    test_status = get_last_test_status(db, [m.id for m in modes])
    results = []
    for m in modes:
        out = ModeOut.model_validate(m)
        if m.id in test_status:
            out.last_tested_at, out.last_test_result = test_status[m.id]
        results.append(out)
    return results


@router.get("/{emitter_id}/generation-batches", response_model=list[ModeGenerationBatchOut])
def list_generation_batches(
    emitter_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[ModeGenerationBatchOut]:
    """Every cartesian-product run for this Emitter, across all its EW Groups/Sources."""
    _get_emitter_or_404(db, emitter_id)
    batches = (
        db.query(ModeGenerationBatch)
        .join(EwGroup, ModeGenerationBatch.ew_group_id == EwGroup.id)
        .filter(EwGroup.emitter_id == emitter_id)
        .order_by(ModeGenerationBatch.created_at.desc())
        .all()
    )
    return [
        ModeGenerationBatchOut(
            id=b.id,
            ew_group_id=b.ew_group_id,
            source_id=b.source_id,
            name_prefix=b.name_prefix,
            created_at=b.created_at,
            mode_count=len(b.modes),
        )
        for b in batches
    ]


@router.delete(
    "/{emitter_id}/generation-batches/{batch_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(verify_csrf)],
)
def delete_generation_batch(
    emitter_id: UUID, batch_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> None:
    """Deletes every Mode this batch generated (cascading their ModeLines), then the batch."""
    _get_emitter_or_404(db, emitter_id)
    batch = db.get(ModeGenerationBatch, batch_id)
    if batch is None or batch.ew_group.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Generation batch not found")
    mode_count = len(batch.modes)
    for mode in list(batch.modes):
        db.delete(mode)
    db.delete(batch)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.mode_generation_batch.value,
        entity_id=batch.id,
        summary=f"Deleted generation batch '{batch.name_prefix}' ({mode_count} Mode(s))",
    )
    db.commit()


@router.post(
    "/{emitter_id}/versions",
    response_model=EmitterVersionOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def commit_emitter_version(
    emitter_id: UUID,
    payload: CommitVersionRequest,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> EmitterVersion:
    emitter = _get_emitter_or_404(db, emitter_id)
    snapshot = build_emitter_snapshot(emitter)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.commit,
        entity_type=AuditEntityType.emitter.value,
        entity_id=emitter.id,
        summary=f"Committed a version of Emitter '{emitter.name}'"
        + (f" — {payload.change_summary}" if payload.change_summary else ""),
    )
    return commit_version(
        db,
        spec=_VERSION_SPEC,
        entity_id=emitter.id,
        snapshot=snapshot,
        change_summary=payload.change_summary,
        created_by=user.id,
    )


@router.get("/{emitter_id}/versions", response_model=list[EmitterVersionOut])
def list_emitter_versions(
    emitter_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[EmitterVersion]:
    _get_emitter_or_404(db, emitter_id)
    return list_versions(db, spec=_VERSION_SPEC, entity_id=emitter_id)


@router.get("/{emitter_id}/versions/{version_number}", response_model=EmitterVersionDetailOut)
def get_emitter_version(
    emitter_id: UUID,
    version_number: int,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> EmitterVersion:
    _get_emitter_or_404(db, emitter_id)
    version = get_version(db, spec=_VERSION_SPEC, entity_id=emitter_id, version_number=version_number)
    if version is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")
    return version


@router.get("/{emitter_id}/versions/{version_number}/diff", response_model=DiffOut)
def diff_emitter_version(
    emitter_id: UUID,
    version_number: int,
    against: int | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> DiffOut:
    _get_emitter_or_404(db, emitter_id)
    from_version = against if against is not None else version_number - 1
    if from_version < 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No prior version to diff against")
    try:
        result = diff_versions(
            db, spec=_VERSION_SPEC, entity_id=emitter_id, from_version=from_version, to_version=version_number
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    return DiffOut(**result)


@router.post("/{emitter_id}/status", response_model=EmitterVersionOut, dependencies=[Depends(verify_csrf)])
def transition_emitter_status(
    emitter_id: UUID,
    payload: StatusTransitionRequest,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> EmitterVersion:
    emitter = _get_emitter_or_404(db, emitter_id)
    try:
        new_status = EmitterStatus(payload.new_status)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown status '{payload.new_status}'") from exc

    try:
        validate_transition(emitter.status.value, new_status.value, EMITTER_STATUS_TRANSITIONS)
    except InvalidStatusTransition as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc

    old_status = emitter.status.value
    emitter.status = new_status
    db.flush()

    summary = f"Status: {old_status} → {new_status.value}"
    if payload.note:
        summary += f" — {payload.note}"

    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.status_change,
        entity_type=AuditEntityType.emitter.value,
        entity_id=emitter.id,
        summary=f"Emitter '{emitter.name}': {summary}",
        changes={"old_status": old_status, "new_status": new_status.value},
    )

    snapshot = build_emitter_snapshot(emitter)
    return commit_version(
        db, spec=_VERSION_SPEC, entity_id=emitter.id, snapshot=snapshot, change_summary=summary, created_by=user.id
    )
