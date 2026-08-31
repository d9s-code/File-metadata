from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_role
from app.models.emitter_version import EmitterVersion
from app.models.platform import Platform, PlatformEmitterLink, PlatformVersion
from app.schemas.emitter_version import CommitVersionRequest, DiffOut
from app.schemas.platform import PlatformCreate, PlatformLinkCreate, PlatformLinkOut, PlatformOut, PlatformUpdate
from app.schemas.platform_version import PlatformVersionDetailOut, PlatformVersionOut
from app.services.audit_service import apply_and_diff, record_audit
from app.services.snapshots import build_platform_snapshot
from app.services.versioning_service import VersionSpec, commit_version, diff_versions, get_version, list_versions

router = APIRouter(prefix="/platforms", tags=["platforms"])

_VERSION_SPEC = VersionSpec(version_model=PlatformVersion, entity_fk_field="platform_id")


def _get_platform_or_404(db: Session, platform_id: UUID) -> Platform:
    platform = db.get(Platform, platform_id)
    if platform is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Platform not found")
    return platform


@router.get("", response_model=list[PlatformOut])
def list_platforms(
    include_deleted: bool = False, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[Platform]:
    q = db.query(Platform)
    if not include_deleted:
        q = q.filter(Platform.is_deleted.is_(False))
    return q.order_by(Platform.name).all()


@router.get("/{platform_id}", response_model=PlatformOut)
def get_platform(
    platform_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> Platform:
    return _get_platform_or_404(db, platform_id)


@router.post("", response_model=PlatformOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
def create_platform(
    payload: PlatformCreate, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> Platform:
    if db.query(Platform).filter(Platform.name == payload.name).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Platform name already exists")
    platform = Platform(name=payload.name, description=payload.description, created_by=user.id)
    db.add(platform)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.platform.value,
        entity_id=platform.id,
        summary=f"Created Platform '{platform.name}'",
        changes=payload.model_dump(mode="json"),
    )
    db.commit()
    db.refresh(platform)
    return platform


@router.patch("/{platform_id}", response_model=PlatformOut, dependencies=[Depends(verify_csrf)])
def update_platform(
    platform_id: UUID,
    payload: PlatformUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> Platform:
    platform = _get_platform_or_404(db, platform_id)
    changes = apply_and_diff(platform, payload.model_dump(exclude_unset=True))
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.platform.value,
        entity_id=platform.id,
        summary=f"Updated Platform '{platform.name}'",
        changes=changes,
    )
    db.commit()
    db.refresh(platform)
    return platform


@router.delete("/{platform_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_platform(
    platform_id: UUID,
    hard: bool = False,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> None:
    platform = _get_platform_or_404(db, platform_id)
    if hard:
        if user.role != Role.admin:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Hard delete requires admin role")
        record_audit(
            db,
            actor_id=user.id,
            action=AuditAction.delete,
            entity_type=AuditEntityType.platform.value,
            entity_id=platform.id,
            summary=f"Hard-deleted Platform '{platform.name}'",
        )
        db.delete(platform)
    else:
        platform.is_deleted = True
        platform.deleted_at = datetime.now(timezone.utc)
        record_audit(
            db,
            actor_id=user.id,
            action=AuditAction.delete,
            entity_type=AuditEntityType.platform.value,
            entity_id=platform.id,
            summary=f"Deleted Platform '{platform.name}'",
        )
    db.commit()


@router.post("/{platform_id}/restore", response_model=PlatformOut, dependencies=[Depends(verify_csrf)])
def restore_platform(
    platform_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> Platform:
    platform = _get_platform_or_404(db, platform_id)
    platform.is_deleted = False
    platform.deleted_at = None
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.restore,
        entity_type=AuditEntityType.platform.value,
        entity_id=platform.id,
        summary=f"Restored Platform '{platform.name}'",
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"An active Platform named '{platform.name}' already exists — rename it before restoring this one.",
        ) from exc
    db.refresh(platform)
    return platform


@router.get("/{platform_id}/links", response_model=list[PlatformLinkOut])
def list_links(
    platform_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[PlatformEmitterLink]:
    _get_platform_or_404(db, platform_id)
    return db.query(PlatformEmitterLink).filter(PlatformEmitterLink.platform_id == platform_id).all()


@router.post(
    "/{platform_id}/links",
    response_model=PlatformLinkOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def pin_emitter(
    platform_id: UUID,
    payload: PlatformLinkCreate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> PlatformEmitterLink:
    """Pins (or repins) a specific committed Emitter version into this
    Platform. Always requires an existing `emitter_versions` row — an
    Emitter with only uncommitted draft changes cannot be pinned.
    """
    platform = _get_platform_or_404(db, platform_id)
    emitter_version = db.get(EmitterVersion, payload.emitter_version_id)
    if emitter_version is None or emitter_version.emitter_id != payload.emitter_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "emitter_version_id must be a committed version of emitter_id"
        )

    existing = (
        db.query(PlatformEmitterLink)
        .filter(PlatformEmitterLink.platform_id == platform_id, PlatformEmitterLink.emitter_id == payload.emitter_id)
        .first()
    )
    if existing is not None:
        existing.emitter_version_id = payload.emitter_version_id
        link = existing
    else:
        link = PlatformEmitterLink(
            platform_id=platform_id, emitter_id=payload.emitter_id, emitter_version_id=payload.emitter_version_id
        )
        db.add(link)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.platform_link.value,
        entity_id=platform.id,
        summary=f"Pinned Emitter version {emitter_version.version_number} into Platform '{platform.name}'",
    )
    db.commit()
    db.refresh(link)
    return link


@router.delete(
    "/{platform_id}/links/{emitter_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)]
)
def unpin_emitter(
    platform_id: UUID,
    emitter_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> None:
    platform = _get_platform_or_404(db, platform_id)
    link = (
        db.query(PlatformEmitterLink)
        .filter(PlatformEmitterLink.platform_id == platform_id, PlatformEmitterLink.emitter_id == emitter_id)
        .first()
    )
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Link not found")
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.platform_link.value,
        entity_id=platform.id,
        summary=f"Unpinned an Emitter from Platform '{platform.name}'",
    )
    db.delete(link)
    db.commit()


@router.post(
    "/{platform_id}/versions",
    response_model=PlatformVersionOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def commit_platform_version(
    platform_id: UUID,
    payload: CommitVersionRequest,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> PlatformVersion:
    platform = _get_platform_or_404(db, platform_id)
    snapshot = build_platform_snapshot(platform)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.commit,
        entity_type=AuditEntityType.platform.value,
        entity_id=platform.id,
        summary=f"Committed a version of Platform '{platform.name}'"
        + (f" — {payload.change_summary}" if payload.change_summary else ""),
    )
    return commit_version(
        db,
        spec=_VERSION_SPEC,
        entity_id=platform.id,
        snapshot=snapshot,
        change_summary=payload.change_summary,
        created_by=user.id,
    )


@router.get("/{platform_id}/versions", response_model=list[PlatformVersionOut])
def list_platform_versions(
    platform_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[PlatformVersion]:
    _get_platform_or_404(db, platform_id)
    return list_versions(db, spec=_VERSION_SPEC, entity_id=platform_id)


@router.get("/{platform_id}/versions/{version_number}", response_model=PlatformVersionDetailOut)
def get_platform_version(
    platform_id: UUID,
    version_number: int,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> PlatformVersion:
    _get_platform_or_404(db, platform_id)
    version = get_version(db, spec=_VERSION_SPEC, entity_id=platform_id, version_number=version_number)
    if version is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")
    return version


@router.get("/{platform_id}/versions/{version_number}/diff", response_model=DiffOut)
def diff_platform_version(
    platform_id: UUID,
    version_number: int,
    against: int | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> DiffOut:
    _get_platform_or_404(db, platform_id)
    from_version = against if against is not None else version_number - 1
    if from_version < 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No prior version to diff against")
    try:
        result = diff_versions(
            db, spec=_VERSION_SPEC, entity_id=platform_id, from_version=from_version, to_version=version_number
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    return DiffOut(**result)
