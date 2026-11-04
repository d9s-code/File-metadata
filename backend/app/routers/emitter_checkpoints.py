"""An Emitter's checkpoints — saves made while editing, between its versions —
and its history of both (see app/services/checkpoint_service.py)."""

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_emitter_checkout, require_role
from app.models.emitter import Emitter
from app.models.emitter_version import EmitterCheckpoint, EmitterVersion
from app.schemas.emitter import EmitterOut
from app.schemas.emitter_version import CommitEmitterVersionRequest, EmitterDiffOut
from app.services import checkpoint_service, statuses
from app.services.audit_service import record_audit
from app.services.checkpoint_service import RefError
from app.services.emitter_diff_service import compute_emitter_diff
from app.services.emitter_revert_service import reconcile_emitter_to_snapshot
from app.services.emitter_summary_service import attach_emitter_summaries
from app.services.reconcile_audit import record_reconcile
from app.services.snapshots import build_emitter_snapshot
from app.services.versioning_service import VersionSpec, commit_version

router = APIRouter(prefix="/emitters", tags=["emitter-checkpoints"])

_VERSION_SPEC = VersionSpec(version_model=EmitterVersion, entity_fk_field="emitter_id")
LIVE = "live"


class CheckpointRequest(BaseModel):
    # A note is optional: a checkpoint is a save along the way, not a release.
    change_summary: str | None = Field(default=None, max_length=2000)


class SaveOut(BaseModel):
    """A version or a checkpoint, as the history lists it."""

    kind: str
    ref: str
    change_summary: str | None = None
    created_at: datetime
    created_by_username: str | None = None
    # A checkpoint made into a version: that version's number.
    promoted_to_version_number: int | None = None
    # A version made from a checkpoint: that checkpoint's ref.
    from_checkpoint: str | None = None


def _emitter(db: Session, emitter_id: UUID) -> Emitter:
    emitter = db.get(Emitter, emitter_id)
    if emitter is None or emitter.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    return emitter


def _save(db: Session, emitter_id: UUID, ref: str) -> checkpoint_service.Save:
    try:
        return checkpoint_service.get_save(db, emitter_id, ref)
    except RefError as err:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(err)) from err


def _live(emitter: Emitter, status_from: dict) -> dict:
    # Status isn't part of what a save captures or a discard throws away.
    return {**build_emitter_snapshot(emitter), "status": status_from.get("status")}


def _out(save: checkpoint_service.Save, promoted_from: dict[int, str]) -> SaveOut:
    row = save.row
    return SaveOut(
        kind=save.kind,
        ref=save.ref,
        change_summary=row.change_summary,
        created_at=row.created_at,
        created_by_username=row.created_by_username,
        promoted_to_version_number=getattr(row, "promoted_to_version_number", None),
        from_checkpoint=promoted_from.get(row.version_number) if save.kind == "version" else None,
    )


@router.get("/{emitter_id}/history", response_model=list[SaveOut])
def emitter_history(emitter_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> list[SaveOut]:
    """Every version and checkpoint, oldest first: v1, v1.1, v1.2, v2 …"""
    _emitter(db, emitter_id)
    saves = checkpoint_service.history(db, emitter_id)
    promoted_from = {
        s.row.promoted_to_version_number: s.ref
        for s in saves
        if s.kind == "checkpoint" and s.row.promoted_to_version_number is not None
    }
    return [_out(s, promoted_from) for s in saves]


@router.get("/{emitter_id}/history/diff", response_model=EmitterDiffOut)
def diff_saves(
    emitter_id: UUID,
    from_: str = Query(alias="from", description="A version (3), a checkpoint (3.1) or 'live'"),
    to: str = Query(LIVE, description="A version (3), a checkpoint (3.1) or 'live'"),
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> EmitterDiffOut:
    """What changed from one save to another, or to the Emitter as it is now."""
    emitter = _emitter(db, emitter_id)
    old = _live(emitter, {}) if from_ == LIVE else _save(db, emitter_id, from_).snapshot
    new = _live(emitter, old) if to == LIVE else _save(db, emitter_id, to).snapshot
    if from_ == LIVE:
        old = {**old, "status": new.get("status")}
    return EmitterDiffOut(**compute_emitter_diff(old, new, statuses.labels(db, "emitter")))


@router.post(
    "/{emitter_id}/checkpoints",
    response_model=SaveOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def save_checkpoint(
    emitter_id: UUID,
    payload: CheckpointRequest,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> SaveOut:
    """Saves the Emitter as it is now as a checkpoint (v3.1 …), keeping the edit
    lock — editing carries on. It isn't a version: nothing pins or tests it."""
    emitter = _emitter(db, emitter_id)
    latest = checkpoint_service.latest_save(db, emitter_id)
    if latest is not None and compute_emitter_diff(latest.snapshot, _live(emitter, latest.snapshot))["identical"]:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Nothing has changed since v{latest.ref}")
    checkpoint = checkpoint_service.create_checkpoint(db, emitter, payload.change_summary, user.id)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.commit,
        entity_type=AuditEntityType.emitter.value,
        entity_id=emitter.id,
        summary=f"Saved checkpoint v{checkpoint.ref} of Emitter '{emitter.name}'"
        + (f" — {checkpoint.change_summary}" if checkpoint.change_summary else ""),
        changes={"checkpoint": checkpoint.ref},
        emitter_id=emitter.id,
    )
    db.commit()
    db.refresh(checkpoint)
    return _out(checkpoint_service.Save("checkpoint", checkpoint.ref, checkpoint.snapshot, checkpoint.created_at, checkpoint), {})


@router.post("/{emitter_id}/checkpoints/{ref}/restore", response_model=EmitterOut, dependencies=[Depends(verify_csrf)])
def go_back_to_checkpoint(
    emitter_id: UUID,
    ref: str,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> EmitterOut:
    """Makes the Emitter as it was at a checkpoint again, while editing — unsaved,
    like any edit, so saving afterwards keeps it and Discard undoes it."""
    emitter = _emitter(db, emitter_id)
    save = _save(db, emitter_id, ref)
    if save.kind != "checkpoint":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That's a version — revert to it from its history instead")
    before = build_emitter_snapshot(emitter)
    reconcile_emitter_to_snapshot(db, emitter, save.snapshot)
    record_reconcile(
        db, actor_id=user.id, emitter_id=emitter.id, before=before, after=build_emitter_snapshot(emitter),
        why=f"going back to checkpoint v{save.ref}",
    )
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.revert,
        entity_type=AuditEntityType.emitter.value,
        entity_id=emitter.id,
        summary=f"Emitter '{emitter.name}': went back to checkpoint v{save.ref} (not saved yet)",
        changes={"checkpoint": save.ref},
        emitter_id=emitter.id,
    )
    db.commit()
    db.refresh(emitter)
    return attach_emitter_summaries(db, [emitter])[0]


@router.post(
    "/{emitter_id}/checkpoints/{ref}/promote",
    response_model=SaveOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def make_checkpoint_a_version(
    emitter_id: UUID,
    ref: str,
    payload: CommitEmitterVersionRequest,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> SaveOut:
    """Makes a checkpoint since the latest version into the next version — the
    one Platforms can pin and tests count against. What's live isn't touched."""
    emitter = _emitter(db, emitter_id)
    if emitter.checked_out_by_id is not None and emitter.checked_out_by_id != user.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Someone else is editing this Emitter")
    save = _save(db, emitter_id, ref)
    if save.kind != "checkpoint":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That's already a version")
    checkpoint: EmitterCheckpoint = save.row
    latest = checkpoint_service.latest_version(db, emitter_id)
    if checkpoint.base_version_number != (latest.version_number if latest else 0):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"v{checkpoint.ref} is from before v{latest.version_number} — only a checkpoint since the latest "
            "version can become the next one",
        )
    # The status it has now, as any version records.
    version = commit_version(
        db,
        spec=_VERSION_SPEC,
        entity_id=emitter.id,
        snapshot={**checkpoint.snapshot, "status": emitter.status},
        change_summary=payload.change_summary,
        created_by=user.id,
        commit=False,
    )
    checkpoint.promoted_to_version_number = version.version_number
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.commit,
        entity_type=AuditEntityType.emitter.value,
        entity_id=emitter.id,
        summary=f"Made checkpoint v{checkpoint.ref} of Emitter '{emitter.name}' into v{version.version_number}"
        f" — {payload.change_summary}",
        changes={"version_number": version.version_number, "from_checkpoint": checkpoint.ref},
        emitter_id=emitter.id,
    )
    db.commit()
    db.refresh(version)
    return _out(
        checkpoint_service.Save("version", str(version.version_number), version.snapshot, version.created_at, version),
        {version.version_number: checkpoint.ref},
    )
