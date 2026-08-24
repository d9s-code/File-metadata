from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import MDF_STATUS_TRANSITIONS, MdfStatus, Role
from app.database import get_db
from app.deps import require_role
from app.models.mdf import Mdf, MdfPlatformLink, MdfVersion
from app.models.platform import PlatformVersion
from app.schemas.emitter_version import CommitVersionRequest, DiffOut, StatusTransitionRequest
from app.schemas.mdf import MdfCreate, MdfLinkCreate, MdfLinkOut, MdfOut, MdfReadinessOut, MdfUpdate
from app.schemas.mdf_version import MdfStatusTransitionOut, MdfVersionDetailOut, MdfVersionOut
from app.services.readiness_service import compute_mdf_readiness_warnings
from app.services.snapshots import build_mdf_snapshot
from app.services.status_service import InvalidStatusTransition, validate_transition
from app.services.versioning_service import VersionSpec, commit_version, diff_versions, get_version, list_versions

router = APIRouter(prefix="/mdfs", tags=["mdfs"])

_VERSION_SPEC = VersionSpec(version_model=MdfVersion, entity_fk_field="mdf_id")


def _get_mdf_or_404(db: Session, mdf_id: UUID) -> Mdf:
    mdf = db.get(Mdf, mdf_id)
    if mdf is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MDF not found")
    return mdf


@router.get("", response_model=list[MdfOut])
def list_mdfs(
    include_deleted: bool = False, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[Mdf]:
    q = db.query(Mdf)
    if not include_deleted:
        q = q.filter(Mdf.is_deleted.is_(False))
    return q.order_by(Mdf.name).all()


@router.get("/{mdf_id}", response_model=MdfOut)
def get_mdf(mdf_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> Mdf:
    return _get_mdf_or_404(db, mdf_id)


@router.post("", response_model=MdfOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
def create_mdf(
    payload: MdfCreate, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> Mdf:
    if db.query(Mdf).filter(Mdf.name == payload.name).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "MDF name already exists")
    mdf = Mdf(name=payload.name, description=payload.description, created_by=user.id)
    db.add(mdf)
    db.commit()
    db.refresh(mdf)
    return mdf


@router.patch("/{mdf_id}", response_model=MdfOut, dependencies=[Depends(verify_csrf)])
def update_mdf(
    mdf_id: UUID, payload: MdfUpdate, db: Session = Depends(get_db), _=Depends(require_role(Role.editor))
) -> Mdf:
    mdf = _get_mdf_or_404(db, mdf_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(mdf, field, value)
    db.commit()
    db.refresh(mdf)
    return mdf


@router.delete("/{mdf_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_mdf(
    mdf_id: UUID,
    hard: bool = False,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> None:
    mdf = _get_mdf_or_404(db, mdf_id)
    if hard:
        if user.role != Role.admin:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Hard delete requires admin role")
        db.delete(mdf)
    else:
        mdf.is_deleted = True
    db.commit()


@router.get("/{mdf_id}/links", response_model=list[MdfLinkOut])
def list_links(mdf_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> list[MdfPlatformLink]:
    _get_mdf_or_404(db, mdf_id)
    return db.query(MdfPlatformLink).filter(MdfPlatformLink.mdf_id == mdf_id).all()


@router.post(
    "/{mdf_id}/links", response_model=MdfLinkOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)]
)
def pin_platform(
    mdf_id: UUID,
    payload: MdfLinkCreate,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.editor)),
) -> MdfPlatformLink:
    """Pins (or repins) a specific committed Platform version into this MDF."""
    _get_mdf_or_404(db, mdf_id)
    platform_version = db.get(PlatformVersion, payload.platform_version_id)
    if platform_version is None or platform_version.platform_id != payload.platform_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "platform_version_id must be a committed version of platform_id"
        )

    existing = (
        db.query(MdfPlatformLink)
        .filter(MdfPlatformLink.mdf_id == mdf_id, MdfPlatformLink.platform_id == payload.platform_id)
        .first()
    )
    if existing is not None:
        existing.platform_version_id = payload.platform_version_id
        link = existing
    else:
        link = MdfPlatformLink(
            mdf_id=mdf_id, platform_id=payload.platform_id, platform_version_id=payload.platform_version_id
        )
        db.add(link)
    db.commit()
    db.refresh(link)
    return link


@router.delete(
    "/{mdf_id}/links/{platform_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)]
)
def unpin_platform(
    mdf_id: UUID, platform_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.editor))
) -> None:
    _get_mdf_or_404(db, mdf_id)
    link = (
        db.query(MdfPlatformLink)
        .filter(MdfPlatformLink.mdf_id == mdf_id, MdfPlatformLink.platform_id == platform_id)
        .first()
    )
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Link not found")
    db.delete(link)
    db.commit()


@router.post(
    "/{mdf_id}/versions", response_model=MdfVersionOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)]
)
def commit_mdf_version(
    mdf_id: UUID,
    payload: CommitVersionRequest,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> MdfVersion:
    mdf = _get_mdf_or_404(db, mdf_id)
    snapshot = build_mdf_snapshot(mdf)
    return commit_version(
        db, spec=_VERSION_SPEC, entity_id=mdf.id, snapshot=snapshot, change_summary=payload.change_summary, created_by=user.id
    )


@router.get("/{mdf_id}/versions", response_model=list[MdfVersionOut])
def list_mdf_versions(mdf_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> list[MdfVersion]:
    _get_mdf_or_404(db, mdf_id)
    return list_versions(db, spec=_VERSION_SPEC, entity_id=mdf_id)


@router.get("/{mdf_id}/versions/{version_number}", response_model=MdfVersionDetailOut)
def get_mdf_version(
    mdf_id: UUID, version_number: int, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> MdfVersion:
    _get_mdf_or_404(db, mdf_id)
    version = get_version(db, spec=_VERSION_SPEC, entity_id=mdf_id, version_number=version_number)
    if version is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")
    return version


@router.get("/{mdf_id}/versions/{version_number}/diff", response_model=DiffOut)
def diff_mdf_version(
    mdf_id: UUID,
    version_number: int,
    against: int | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> DiffOut:
    _get_mdf_or_404(db, mdf_id)
    from_version = against if against is not None else version_number - 1
    if from_version < 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No prior version to diff against")
    try:
        result = diff_versions(db, spec=_VERSION_SPEC, entity_id=mdf_id, from_version=from_version, to_version=version_number)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    return DiffOut(**result)


@router.get("/{mdf_id}/status/readiness", response_model=MdfReadinessOut)
def get_mdf_readiness(
    mdf_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> MdfReadinessOut:
    """Read-only preview of the soft warnings a status transition would
    surface — lets the UI show them before the user confirms.
    """
    mdf = _get_mdf_or_404(db, mdf_id)
    return MdfReadinessOut(warnings=compute_mdf_readiness_warnings(db, mdf))


@router.post("/{mdf_id}/status", response_model=MdfStatusTransitionOut, dependencies=[Depends(verify_csrf)])
def transition_mdf_status(
    mdf_id: UUID,
    payload: StatusTransitionRequest,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> MdfStatusTransitionOut:
    mdf = _get_mdf_or_404(db, mdf_id)
    try:
        new_status = MdfStatus(payload.new_status)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown status '{payload.new_status}'") from exc

    try:
        validate_transition(mdf.status.value, new_status.value, MDF_STATUS_TRANSITIONS)
    except InvalidStatusTransition as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc

    warnings = compute_mdf_readiness_warnings(db, mdf)

    old_status = mdf.status.value
    mdf.status = new_status
    db.flush()

    summary = f"Status: {old_status} → {new_status.value}"
    if payload.note:
        summary += f" — {payload.note}"

    snapshot = build_mdf_snapshot(mdf)
    version = commit_version(
        db, spec=_VERSION_SPEC, entity_id=mdf.id, snapshot=snapshot, change_summary=summary, created_by=user.id
    )
    return MdfStatusTransitionOut(**MdfVersionOut.model_validate(version).model_dump(), warnings=warnings)
