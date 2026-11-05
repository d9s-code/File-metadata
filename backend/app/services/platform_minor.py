"""Minor Platform versions: repinning an Emitter that's in the Platform's
saved version saves the next minor version (v3 → v3.1 → v3.2) on its own —
the saved version with just that pin moved. Other changes not saved yet
stay unsaved; Save version makes the next whole version (v4)."""

from __future__ import annotations

import copy
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.enums import AuditAction, AuditEntityType
from app.models.emitter_version import EmitterVersion
from app.models.platform import Platform, PlatformVersion
from app.services.audit_service import record_audit


def latest_platform_version(db: Session, platform_id: UUID) -> PlatformVersion | None:
    return (
        db.query(PlatformVersion)
        .filter(PlatformVersion.platform_id == platform_id)
        .order_by(PlatformVersion.version_number.desc())
        .first()
    )


def save_minor_version(
    db: Session, platform: Platform, user_id: UUID | None, repinned: dict[str, EmitterVersion]
) -> PlatformVersion | None:
    """The Platform's latest saved version with these Emitters (by id) at
    these versions, saved as its next minor version. None when it has no
    saved version yet, or none of them is in it at another version."""
    latest = latest_platform_version(db, platform.id)
    if latest is None:
        return None
    snapshot = copy.deepcopy(latest.snapshot)
    moved = []
    for entry in snapshot.get("links", []):
        ev = repinned.get(str(entry.get("emitter_id")))
        if ev is None or entry.get("emitter_version_id") == str(ev.id):
            continue
        moved.append(f"{entry.get('emitter_name')} v{entry.get('emitter_version_number')} → v{ev.version_number}")
        entry.update(emitter_version_id=str(ev.id), emitter_version_number=ev.version_number, emitter_snapshot=ev.snapshot)
    if not moved:
        return None
    major = latest.major or latest.version_number
    minor = (
        db.query(func.max(PlatformVersion.minor))
        .filter(PlatformVersion.platform_id == platform.id, PlatformVersion.major == major)
        .scalar()
        or 0
    ) + 1
    summary = "Repinned " + ", ".join(moved)
    version = PlatformVersion(
        platform_id=platform.id,
        version_number=latest.version_number + 1,
        major=major,
        minor=minor,
        snapshot=snapshot,
        change_summary=summary,
        created_by=user_id,
    )
    db.add(version)
    db.flush()
    record_audit(
        db,
        actor_id=user_id,
        action=AuditAction.commit,
        entity_type=AuditEntityType.platform.value,
        entity_id=platform.id,
        summary=f"Saved Platform '{platform.name}' v{version.version_label} — {summary}",
    )
    return version


def version_labels(db: Session, version_ids) -> dict:
    """Platform version id → its label ("3", "3.1")."""
    ids = [v for v in version_ids if v]
    if not ids:
        return {}
    rows = db.query(PlatformVersion.id, PlatformVersion.major, PlatformVersion.minor, PlatformVersion.version_number).filter(
        PlatformVersion.id.in_(ids)
    )
    from app.models.platform import platform_version_label

    return {vid: platform_version_label(major or number, minor) for vid, major, minor, number in rows}
