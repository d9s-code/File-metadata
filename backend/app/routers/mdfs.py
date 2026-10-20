from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.services import milestones, statuses
from app.deps import require_role
from app.models.customer import Customer
from app.models.mdf import Mdf, MdfPlatformLink, MdfVersion
from app.models.mdf_note import MdfNote
from app.models.platform import PlatformVersion
from app.schemas.emitter_version import CommitVersionRequest, DiffOut, StatusTransitionRequest
from app.schemas.mdf import MdfCreate, MdfLinkCreate, MdfLinkOut, MdfOut, MdfReadinessOut, MdfUpdate, ReadinessItem
from app.schemas.mdf_note import MdfNoteCreate, MdfNoteOut
from app.services.platform_coverage import mdf_coverage
from app.schemas.mdf_version import MdfStatusTransitionOut, MdfVersionDetailOut, MdfVersionOut
from app.services.audit_service import apply_and_diff, record_audit, snapshot
from app.services.dwell_service import commit_file, mdf_dwell_files, unsaved_files
from app.services.prs_export.packager import build_mdf_export_zip
from app.services.pin_hygiene import latest_platform_versions, mdf_readiness
from app.services.readiness_service import compute_mdf_readiness_warnings
from app.services.snapshots import build_mdf_snapshot
from app.services.pinned_diff_service import compute_pinned_diff, dwell_file_entries
from app.services.versioning_service import VersionSpec, commit_version, diff_versions, get_version, list_versions
from app.xml_export.serializer import serialize_mdf_snapshot_to_xml

router = APIRouter(prefix="/mdfs", tags=["mdfs"])

_VERSION_SPEC = VersionSpec(version_model=MdfVersion, entity_fk_field="mdf_id")


def _get_mdf_or_404(db: Session, mdf_id: UUID) -> Mdf:
    mdf = db.get(Mdf, mdf_id)
    if mdf is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MDF not found")
    return mdf


def _attach_platforms_count(db: Session, mdf: Mdf) -> Mdf:
    mdf.platforms_count = db.query(func.count(MdfPlatformLink.id)).filter(MdfPlatformLink.mdf_id == mdf.id).scalar() or 0
    return mdf


def _check_customer(db: Session, customer_id: UUID | None) -> None:
    if customer_id is None:
        return
    if db.get(Customer, customer_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")


@router.get("", response_model=list[MdfOut])
def list_mdfs(
    include_deleted: bool = False, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[Mdf]:
    query = (
        db.query(Mdf, func.count(MdfPlatformLink.id).label("platforms_count"))
        .outerjoin(MdfPlatformLink, MdfPlatformLink.mdf_id == Mdf.id)
        .group_by(Mdf.id)
        .order_by(Mdf.name)
    )
    if not include_deleted:
        query = query.filter(Mdf.is_deleted.is_(False))
    results = []
    for mdf, platforms_count in query.all():
        mdf.platforms_count = platforms_count
        results.append(mdf)
    return results


@router.get("/{mdf_id}", response_model=MdfOut)
def get_mdf(mdf_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> Mdf:
    return _attach_platforms_count(db, _get_mdf_or_404(db, mdf_id))


@router.post("", response_model=MdfOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
def create_mdf(
    payload: MdfCreate, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> Mdf:
    if db.query(Mdf).filter(Mdf.name == payload.name, Mdf.is_deleted.is_(False)).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "MDF name already exists")
    _check_customer(db, payload.customer_id)
    mdf = Mdf(
        name=payload.name,
        description=payload.description,
        notes=payload.notes,
        release_date=payload.release_date,
        customer_id=payload.customer_id,
        created_by=user.id,
    )
    db.add(mdf)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.mdf.value,
        entity_id=mdf.id,
        summary=f"Created MDF '{mdf.name}'",
        changes=payload.model_dump(mode="json"),
    )
    db.commit()
    db.refresh(mdf)
    return _attach_platforms_count(db, mdf)


@router.patch("/{mdf_id}", response_model=MdfOut, dependencies=[Depends(verify_csrf)])
def update_mdf(
    mdf_id: UUID, payload: MdfUpdate, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> Mdf:
    mdf = _get_mdf_or_404(db, mdf_id)
    data = payload.model_dump(exclude_unset=True)
    if "customer_id" in data:
        _check_customer(db, data["customer_id"])
    changes = apply_and_diff(mdf, data)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.mdf.value,
        entity_id=mdf.id,
        summary=f"Updated MDF '{mdf.name}'",
        changes=changes,
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "MDF name already exists") from exc
    db.refresh(mdf)
    return _attach_platforms_count(db, mdf)


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
        record_audit(
            db,
            actor_id=user.id,
            action=AuditAction.delete,
            entity_type=AuditEntityType.mdf.value,
            entity_id=mdf.id,
            summary=f"Hard-deleted MDF '{mdf.name}'",
            changes=snapshot(mdf, ["name", "description", "notes", "release_date", "customer_id", "status"]),
        )
        db.delete(mdf)
    else:
        mdf.is_deleted = True
        mdf.deleted_at = datetime.now(timezone.utc)
        record_audit(
            db,
            actor_id=user.id,
            action=AuditAction.delete,
            entity_type=AuditEntityType.mdf.value,
            entity_id=mdf.id,
            summary=f"Deleted MDF '{mdf.name}'",
            changes=snapshot(mdf, ["name", "description", "notes", "release_date", "customer_id", "status"]),
        )
    db.commit()


@router.post("/{mdf_id}/restore", response_model=MdfOut, dependencies=[Depends(verify_csrf)])
def restore_mdf(
    mdf_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> Mdf:
    mdf = _get_mdf_or_404(db, mdf_id)
    mdf.is_deleted = False
    mdf.deleted_at = None
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.restore,
        entity_type=AuditEntityType.mdf.value,
        entity_id=mdf.id,
        summary=f"Restored MDF '{mdf.name}'",
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"An active MDF named '{mdf.name}' already exists — rename it before restoring this one.",
        ) from exc
    db.refresh(mdf)
    return _attach_platforms_count(db, mdf)


@router.get("/{mdf_id}/notes", response_model=list[MdfNoteOut])
def list_mdf_notes(
    mdf_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[MdfNote]:
    """Newest-first analyst commentary log — see MdfNote."""
    _get_mdf_or_404(db, mdf_id)
    return (
        db.query(MdfNote)
        .options(joinedload(MdfNote.author))
        .filter(MdfNote.mdf_id == mdf_id)
        .order_by(MdfNote.created_at.desc())
        .all()
    )


@router.post(
    "/{mdf_id}/notes",
    response_model=MdfNoteOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def create_mdf_note(
    mdf_id: UUID,
    payload: MdfNoteCreate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> MdfNote:
    mdf = _get_mdf_or_404(db, mdf_id)
    note = MdfNote(mdf_id=mdf_id, author_id=user.id, body=payload.body)
    db.add(note)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.mdf_note.value,
        entity_id=note.id,
        summary=f"Added a note to MDF '{mdf.name}'",
    )
    db.commit()
    db.refresh(note)
    return note


@router.delete("/{mdf_id}/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_mdf_note(
    mdf_id: UUID,
    note_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> None:
    mdf = _get_mdf_or_404(db, mdf_id)
    note = db.get(MdfNote, note_id)
    if note is None or note.mdf_id != mdf_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found")
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.mdf_note.value,
        entity_id=note.id,
        summary=f"Deleted a note from MDF '{mdf.name}'",
        changes=snapshot(note, ["body"]),
    )
    db.delete(note)
    db.commit()


def _links_with_version_numbers(db: Session, links: list[MdfPlatformLink]) -> list[MdfLinkOut]:
    latest = latest_platform_versions(db, [link.platform_id for link in links])
    out = []
    for link in links:
        item = MdfLinkOut.model_validate(link)
        item.pinned_version_number = link.platform_version.version_number
        if link.platform_id in latest:
            item.latest_version_number, item.latest_version_id = latest[link.platform_id]
        out.append(item)
    return out


@router.get("/{mdf_id}/links", response_model=list[MdfLinkOut])
def list_links(mdf_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> list[MdfLinkOut]:
    _get_mdf_or_404(db, mdf_id)
    links = db.query(MdfPlatformLink).filter(MdfPlatformLink.mdf_id == mdf_id).all()
    return _links_with_version_numbers(db, links)


@router.post("/{mdf_id}/links/repin-latest", response_model=list[MdfLinkOut], dependencies=[Depends(verify_csrf)])
def repin_platforms_to_latest(
    mdf_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> list[MdfLinkOut]:
    """Move every pinned Platform with a newer saved version to that version."""
    mdf = _get_mdf_or_404(db, mdf_id)
    links = db.query(MdfPlatformLink).filter(MdfPlatformLink.mdf_id == mdf_id).all()
    latest = latest_platform_versions(db, [link.platform_id for link in links])
    moved = []
    for link in links:
        number, version_id = latest.get(link.platform_id, (None, None))
        if number is not None and number > link.platform_version.version_number:
            moved.append(f"{link.platform.name} v{link.platform_version.version_number} → v{number}")
            link.platform_version_id = version_id
    if moved:
        record_audit(
            db,
            actor_id=user.id,
            action=AuditAction.update,
            entity_type=AuditEntityType.mdf_link.value,
            entity_id=mdf.id,
            summary=f"Repinned {len(moved)} Platform(s) in MDF '{mdf.name}' to their latest version: " + ", ".join(moved),
        )
        db.commit()
    for link in links:
        db.refresh(link)
    return _links_with_version_numbers(db, links)


@router.get("/{mdf_id}/readiness", response_model=list[ReadinessItem])
def get_mdf_readiness_checklist(
    mdf_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[dict]:
    """What should be true before the MDF goes out: pins saved and current,
    Emitters Operational and passing their Simulation Tests, no open
    High/Exact ambiguity, a passing MDF test — each ok, warn or fail."""
    return mdf_readiness(db, _get_mdf_or_404(db, mdf_id))


@router.post(
    "/{mdf_id}/links", response_model=MdfLinkOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)]
)
def pin_platform(
    mdf_id: UUID,
    payload: MdfLinkCreate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> MdfPlatformLink:
    """Pins (or repins) a specific committed Platform version into this MDF."""
    mdf = _get_mdf_or_404(db, mdf_id)
    platform_version = db.get(PlatformVersion, payload.platform_version_id)
    if platform_version is None or platform_version.platform_id != payload.platform_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "platform_version_id must be a committed version of platform_id"
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
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.mdf_link.value,
        entity_id=mdf.id,
        summary=f"Pinned Platform version {platform_version.version_number} into MDF '{mdf.name}'",
    )
    db.commit()
    db.refresh(link)
    return link


@router.delete(
    "/{mdf_id}/links/{platform_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)]
)
def unpin_platform(
    mdf_id: UUID, platform_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> None:
    mdf = _get_mdf_or_404(db, mdf_id)
    link = (
        db.query(MdfPlatformLink)
        .filter(MdfPlatformLink.mdf_id == mdf_id, MdfPlatformLink.platform_id == platform_id)
        .first()
    )
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Link not found")
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.mdf_link.value,
        entity_id=mdf.id,
        summary=f"Unpinned Platform '{link.platform.name}' from MDF '{mdf.name}'",
        changes=snapshot(link, ["platform_id", "platform_version_id"]),
    )
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
    # Its dwell files go in as they are now: one changed since its last saved
    # version (or never saved) is saved first, so the MDF version holds it.
    for dwell_file in unsaved_files(db, mdf.id):
        saved = commit_file(db, dwell_file, f"Saved with MDF '{mdf.name}'", user.id)
        record_audit(
            db,
            actor_id=user.id,
            action=AuditAction.commit,
            entity_type=AuditEntityType.dwell_file.value,
            entity_id=dwell_file.id,
            summary=f"Saved v{saved.version_number} of dwell file '{dwell_file.name}' with MDF '{mdf.name}'",
        )
    snapshot = build_mdf_snapshot(mdf)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.commit,
        entity_type=AuditEntityType.mdf.value,
        entity_id=mdf.id,
        summary=f"Committed a version of MDF '{mdf.name}'"
        + (f" — {payload.change_summary}" if payload.change_summary else ""),
    )
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
    old = get_version(db, spec=_VERSION_SPEC, entity_id=mdf_id, version_number=from_version)
    new = get_version(db, spec=_VERSION_SPEC, entity_id=mdf_id, version_number=version_number)
    entries = compute_pinned_diff(
        old.snapshot, new.snapshot, own="MDF", child="platform", status_labels=statuses.labels(db, "mdf")
    ) + dwell_file_entries(old.snapshot, new.snapshot)
    return DiffOut(**result, entries=entries)


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
    target, open_ones = milestones.check_status_move(
        db, "mdf", mdf.id, mdf.status, payload.new_status, payload.note, payload.confirm_unmet
    )

    warnings = compute_mdf_readiness_warnings(db, mdf)

    old_status = mdf.status
    mdf.status = target.key
    db.flush()

    summary = f"Status: {statuses.label(db, 'mdf', old_status)} → {target.label}"
    if payload.note:
        summary += f" — {payload.note}"
    summary += milestones.unmet_suffix(open_ones)

    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.status_change,
        entity_type=AuditEntityType.mdf.value,
        entity_id=mdf.id,
        summary=f"MDF '{mdf.name}': {summary}",
        changes={"status": {"old": old_status, "new": target.key}, "milestones_not_met": open_ones or None},
    )

    # Where it stands, not part of its content: no version for it (the next
    # saved version records it).
    db.commit()
    return MdfStatusTransitionOut(status=mdf.status, warnings=warnings)


@router.get("/{mdf_id}/versions/{version_number}/export.xml")
def export_mdf_version_xml(
    mdf_id: UUID,
    version_number: int,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> Response:
    """Exports a committed MDF version to the (placeholder-mapped) target
    XML format — Platforms -> Emitters -> EW Groups -> Modes -> mode lines.
    Sources and their elements are authoring-only and never appear here.
    """
    _get_mdf_or_404(db, mdf_id)
    version = get_version(db, spec=_VERSION_SPEC, entity_id=mdf_id, version_number=version_number)
    if version is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")

    xml_bytes = serialize_mdf_snapshot_to_xml(version.snapshot, version_number)
    filename = f"mdf_{version.mdf_id}_v{version_number}.xml"
    return Response(
        content=xml_bytes,
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{mdf_id}/versions/{version_number}/export/prs")
def export_mdf_version_prs(
    mdf_id: UUID,
    version_number: int,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> Response:
    """Exports a committed MDF version to a PRS-format ZIP package —
    platforms/, emitters/, and the library-root file, walking the full
    pinned hierarchy (MDF -> Platforms -> Emitters). See
    docs/XML_IMPORT_BRIEF.md for the format reference and known gaps.
    """
    _get_mdf_or_404(db, mdf_id)
    version = get_version(db, spec=_VERSION_SPEC, entity_id=mdf_id, version_number=version_number)
    if version is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")

    dwell_files = mdf_dwell_files(db, mdf_id, version.snapshot)
    zip_bytes = build_mdf_export_zip(version.snapshot, mdf_id=str(mdf_id), dwell_files=dwell_files)
    filename = f"mdf_{mdf_id}_v{version_number}_prs.zip"
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{mdf_id}/coverage")
def get_mdf_coverage(mdf_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> list[dict]:
    """Each pinned Platform version with what its Emitters cover — for the MDF's charts."""
    _get_mdf_or_404(db, mdf_id)
    return mdf_coverage(db, mdf_id)
