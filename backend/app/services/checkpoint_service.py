"""An Emitter's checkpoints — saves made while editing, between its versions.

A version (v3) is what Platforms pin, exports use and tests count against. A
checkpoint (v3.1, v3.2 …) is a save along the way: kept in the history, able
to be gone back to while editing or made into the next version, but never
pinned, exported or tested against. Unsaved changes and Discard count from
the latest save of either kind.

Refs name a save in requests and the history: "3" is version 3, "3.1" a
checkpoint after it, "live" the Emitter as it is now.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.emitter import Emitter
from app.models.emitter_version import EmitterCheckpoint, EmitterVersion
from app.services.snapshots import build_emitter_snapshot


class RefError(ValueError):
    """A ref that isn't "N", "N.M" or "live", or names no save."""


@dataclass
class Save:
    """A version or a checkpoint, as the history lists it."""

    kind: str  # "version" | "checkpoint"
    ref: str
    snapshot: dict
    created_at: datetime
    row: EmitterVersion | EmitterCheckpoint


def latest_version(db: Session, emitter_id: UUID) -> EmitterVersion | None:
    return (
        db.query(EmitterVersion)
        .filter(EmitterVersion.emitter_id == emitter_id)
        .order_by(EmitterVersion.version_number.desc())
        .first()
    )


def checkpoints_since(db: Session, emitter_id: UUID, base: int) -> list[EmitterCheckpoint]:
    """The checkpoints after version `base` (0: before the first), oldest first."""
    return (
        db.query(EmitterCheckpoint)
        .filter(EmitterCheckpoint.emitter_id == emitter_id, EmitterCheckpoint.base_version_number == base)
        .order_by(EmitterCheckpoint.number)
        .all()
    )


def latest_save(db: Session, emitter_id: UUID) -> Save | None:
    """What unsaved changes are counted from: the newest checkpoint since the
    latest version, else that version — None before anything was saved."""
    version = latest_version(db, emitter_id)
    base = version.version_number if version else 0
    since = checkpoints_since(db, emitter_id, base)
    if since:
        cp = since[-1]
        return Save("checkpoint", cp.ref, cp.snapshot, cp.created_at, cp)
    if version is not None:
        return Save("version", str(version.version_number), version.snapshot, version.created_at, version)
    return None


def create_checkpoint(db: Session, emitter: Emitter, summary: str | None, user_id: UUID) -> EmitterCheckpoint:
    """Saves the Emitter as it is now as the next checkpoint after its latest version."""
    version = latest_version(db, emitter.id)
    base = version.version_number if version else 0
    last = (
        db.query(func.max(EmitterCheckpoint.number))
        .filter(EmitterCheckpoint.emitter_id == emitter.id, EmitterCheckpoint.base_version_number == base)
        .scalar()
    )
    checkpoint = EmitterCheckpoint(
        emitter_id=emitter.id,
        base_version_number=base,
        number=(last or 0) + 1,
        snapshot=build_emitter_snapshot(emitter),
        change_summary=(summary or "").strip() or None,
        created_by=user_id,
    )
    db.add(checkpoint)
    db.flush()
    return checkpoint


def get_save(db: Session, emitter_id: UUID, ref: str) -> Save:
    """The version ("3") or checkpoint ("3.1") a ref names."""
    try:
        if "." in ref:
            base_text, number_text = ref.split(".", 1)
            base, number = int(base_text), int(number_text)
        else:
            base, number = int(ref), None
    except ValueError as err:
        raise RefError(f"'{ref}' isn't a version (3) or a checkpoint (3.1)") from err
    if number is None:
        version = (
            db.query(EmitterVersion)
            .filter(EmitterVersion.emitter_id == emitter_id, EmitterVersion.version_number == base)
            .first()
        )
        if version is None:
            raise RefError(f"There's no v{ref}")
        return Save("version", ref, version.snapshot, version.created_at, version)
    checkpoint = (
        db.query(EmitterCheckpoint)
        .filter(
            EmitterCheckpoint.emitter_id == emitter_id,
            EmitterCheckpoint.base_version_number == base,
            EmitterCheckpoint.number == number,
        )
        .first()
    )
    if checkpoint is None:
        raise RefError(f"There's no checkpoint v{ref}")
    return Save("checkpoint", checkpoint.ref, checkpoint.snapshot, checkpoint.created_at, checkpoint)


def history(db: Session, emitter_id: UUID) -> list[Save]:
    """Every version and checkpoint, oldest first: v1, v1.1, v1.2, v2 …"""
    versions = db.query(EmitterVersion).filter(EmitterVersion.emitter_id == emitter_id).all()
    checkpoints = db.query(EmitterCheckpoint).filter(EmitterCheckpoint.emitter_id == emitter_id).all()
    saves = [Save("version", str(v.version_number), v.snapshot, v.created_at, v) for v in versions] + [
        Save("checkpoint", c.ref, c.snapshot, c.created_at, c) for c in checkpoints
    ]

    def order(s: Save) -> tuple[int, int]:
        if s.kind == "version":
            return (s.row.version_number, 0)
        return (s.row.base_version_number, s.row.number)

    return sorted(saves, key=order)
