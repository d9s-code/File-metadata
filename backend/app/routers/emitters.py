from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import EMITTER_STATUS_TRANSITIONS, EmitterStatus, Role
from app.database import get_db
from app.deps import require_role
from app.models.emitter import Emitter
from app.models.emitter_version import EmitterVersion
from app.schemas.emitter import EmitterCreate, EmitterOut, EmitterUpdate
from app.schemas.emitter_version import (
    CommitVersionRequest,
    DiffOut,
    EmitterVersionDetailOut,
    EmitterVersionOut,
    StatusTransitionRequest,
)
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
    db.commit()
    db.refresh(emitter)
    return emitter


@router.patch("/{emitter_id}", response_model=EmitterOut, dependencies=[Depends(verify_csrf)])
def update_emitter(
    emitter_id: UUID,
    payload: EmitterUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.editor)),
) -> Emitter:
    emitter = db.get(Emitter, emitter_id)
    if emitter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(emitter, field, value)
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
        db.delete(emitter)
    else:
        emitter.is_deleted = True
    db.commit()


def _get_emitter_or_404(db: Session, emitter_id: UUID) -> Emitter:
    emitter = db.get(Emitter, emitter_id)
    if emitter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    return emitter


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

    snapshot = build_emitter_snapshot(emitter)
    return commit_version(
        db, spec=_VERSION_SPEC, entity_id=emitter.id, snapshot=snapshot, change_summary=summary, created_by=user.id
    )
