from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.csrf import verify_csrf
from app.core.downloads import attachment_disposition
from app.core.enums import EMITTER_STATUS_TRANSITIONS, AuditAction, AuditEntityType, EmitterStatus, Role
from app.database import get_db
from app.deps import require_emitter_checkout, require_role
from app.models.emitter import Emitter
from app.models.emitter_note import EmitterNote
from app.models.emitter_version import EmitterVersion
from app.models.ew_group import EwGroup
from app.models.mode import Mode, ModeGenerationBatch
from app.schemas.emitter import EmitterCreate, EmitterOut, EmitterUpdate
from app.schemas.emitter_note import EmitterNoteCreate, EmitterNoteOut
from app.schemas.mode import ModeBatchEditRequest, ModeBatchEditResult, ModeGenerationBatchOut, ModeOut
from app.schemas.emitter_version import (
    CommitEmitterVersionRequest,
    EmitterDiffOut,
    EmitterVersionDetailOut,
    EmitterVersionOut,
    ForkRequest,
    StatusTransitionRequest,
)
from app.services import checkout_service
from app.services.audit_service import apply_and_diff, record_audit, snapshot
from app.services.emitter_diff_service import compute_emitter_diff
from app.services.emitter_revert_service import build_forked_emitter, reconcile_emitter_to_snapshot
from app.services.emitter_summary_service import attach_emitter_summaries
from app.services.mode_batch_service import apply_batch_edit, plan_batch_edit
from app.services.mode_test_status_service import attach_mode_extras
from app.services.snapshots import build_emitter_snapshot
from app.services.status_service import InvalidStatusTransition, validate_transition
from app.services.versioning_service import VersionSpec, commit_version, get_version, list_versions
from app.services.prs_export.serializer import sanitize_filename
from app.services.xml_export.xml_exporter_service import XMLExporterService
from fastapi import Response

router = APIRouter(prefix="/emitters", tags=["emitters"])

_VERSION_SPEC = VersionSpec(version_model=EmitterVersion, entity_fk_field="emitter_id")


def _active_name_taken(db: Session, name: str) -> bool:
    return db.query(Emitter).filter(Emitter.name == name, Emitter.is_deleted.is_(False)).first() is not None


@router.get("", response_model=list[EmitterOut])
def list_emitters(
    include_deleted: bool = False,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> list[EmitterOut]:
    q = db.query(Emitter)
    if not include_deleted:
        q = q.filter(Emitter.is_deleted.is_(False))
    emitters = q.order_by(Emitter.name).all()
    return attach_emitter_summaries(db, emitters)


@router.get("/{emitter_id}", response_model=EmitterOut)
def get_emitter(
    emitter_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> EmitterOut:
    emitter = db.get(Emitter, emitter_id)
    if emitter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    return attach_emitter_summaries(db, [emitter])[0]


@router.post(
    "",
    response_model=EmitterOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def create_emitter(
    payload: EmitterCreate, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> Emitter:
    if _active_name_taken(db, payload.name):
        raise HTTPException(status.HTTP_409_CONFLICT, "Emitter name already exists")
    emitter = Emitter(
        name=payload.name,
        designation=payload.designation,
        description=payload.description,
        created_by=user.id,
    )
    db.add(emitter)
    db.flush()
    checkout_service.start_checkout(emitter, user.id)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.emitter.value,
        entity_id=emitter.id,
        summary=f"Created Emitter '{emitter.name}'",
        changes=payload.model_dump(mode="json"),
        emitter_id=emitter.id,
    )
    db.commit()
    db.refresh(emitter)
    return emitter


@router.patch("/{emitter_id}", response_model=EmitterOut, dependencies=[Depends(verify_csrf)])
def update_emitter(
    emitter_id: UUID,
    payload: EmitterUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> Emitter:
    emitter = db.get(Emitter, emitter_id)
    if emitter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    changes = apply_and_diff(emitter, payload.model_dump(exclude_unset=True))
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.emitter.value,
        entity_id=emitter.id,
        summary=f"Updated Emitter '{emitter.name}'",
        changes=changes,
        emitter_id=emitter.id,
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Emitter name already exists") from exc
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
    held_by_someone_else = emitter.checked_out_by_id is not None and emitter.checked_out_by_id != user.id
    if held_by_someone_else and user.role != Role.admin:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This Emitter is checked out by another user — only they or an Admin can delete it",
        )
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
            changes=snapshot(emitter, ["name", "designation", "description", "status"]),
            emitter_id=emitter.id,
        )
        db.delete(emitter)
    else:
        emitter.is_deleted = True
        emitter.deleted_at = datetime.now(timezone.utc)
        checkout_service.release_checkout(emitter)
        record_audit(
            db,
            actor_id=user.id,
            action=AuditAction.delete,
            entity_type=AuditEntityType.emitter.value,
            entity_id=emitter.id,
            summary=f"Deleted Emitter '{emitter.name}'",
            changes=snapshot(emitter, ["name", "designation", "description", "status"]),
            emitter_id=emitter.id,
        )
    db.commit()


@router.post("/{emitter_id}/restore", response_model=EmitterOut, dependencies=[Depends(verify_csrf)])
def restore_emitter(
    emitter_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> Emitter:
    emitter = _get_emitter_or_404(db, emitter_id)
    emitter.is_deleted = False
    emitter.deleted_at = None
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.restore,
        entity_type=AuditEntityType.emitter.value,
        entity_id=emitter.id,
        summary=f"Restored Emitter '{emitter.name}'",
        emitter_id=emitter.id,
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"An active Emitter named '{emitter.name}' already exists — rename it before restoring this one.",
        ) from exc
    db.refresh(emitter)
    return emitter


def _get_emitter_or_404(db: Session, emitter_id: UUID) -> Emitter:
    emitter = db.get(Emitter, emitter_id)
    if emitter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    return emitter


def _lock_emitter_for_checkout(db: Session, emitter_id: UUID) -> Emitter:
    """Row-locks the Emitter so two simultaneous checkouts can't both see it
    as free; the second waits for the first to commit, then gets a 409."""
    emitter = db.get(Emitter, emitter_id, with_for_update=True, populate_existing=True)
    if emitter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    if emitter.is_deleted:
        raise HTTPException(status.HTTP_409_CONFLICT, "This Emitter is deleted — restore it before editing")
    return emitter


@router.post("/{emitter_id}/checkout", response_model=EmitterOut, dependencies=[Depends(verify_csrf)])
def checkout_emitter(
    emitter_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> EmitterOut:
    """Claims the editing lock — required before PATCHing the Emitter or any
    of its EW Groups/Sources/Modes/Elements. Idempotent if you already hold
    it; 409s if someone else does.
    """
    emitter = _lock_emitter_for_checkout(db, emitter_id)
    try:
        checkout_service.start_checkout(emitter, user.id)
    except checkout_service.AlreadyCheckedOutBySomeoneElse as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Checked out by another user (since {emitter.checked_out_at})") from exc
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.checkout,
        entity_type=AuditEntityType.emitter.value,
        entity_id=emitter.id,
        summary=f"Started editing Emitter '{emitter.name}'",
        emitter_id=emitter.id,
    )
    db.commit()
    db.refresh(emitter)
    return attach_emitter_summaries(db, [emitter])[0]


@router.delete("/{emitter_id}/checkout", response_model=EmitterOut, dependencies=[Depends(verify_csrf)])
def checkin_emitter(
    emitter_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> EmitterOut:
    """Releases the editing lock without discarding anything — whatever is
    currently live stays live, just no longer exclusively held. The holder
    can always do this; an Admin can also force-release someone else's.
    """
    emitter = _get_emitter_or_404(db, emitter_id)
    if emitter.checked_out_by_id is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This Emitter isn't checked out")
    if emitter.checked_out_by_id != user.id and user.role != Role.admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the holder or an Admin can release this checkout")
    checkout_service.release_checkout(emitter)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.checkin,
        entity_type=AuditEntityType.emitter.value,
        entity_id=emitter.id,
        summary=f"Checked in Emitter '{emitter.name}'",
        emitter_id=emitter.id,
    )
    db.commit()
    db.refresh(emitter)
    return attach_emitter_summaries(db, [emitter])[0]


@router.post("/{emitter_id}/discard", response_model=EmitterOut, dependencies=[Depends(verify_csrf)])
def discard_emitter_changes(
    emitter_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> EmitterOut:
    """Reconciles live rows back to the latest committed version and releases
    the checkout — for uncommitted edits you want to throw away. Nothing new
    is committed, since nothing here is worth keeping a record of.
    """
    emitter = _get_emitter_or_404(db, emitter_id)
    versions = list_versions(db, spec=_VERSION_SPEC, entity_id=emitter_id)
    if not versions:
        raise HTTPException(status.HTTP_409_CONFLICT, "This Emitter has no committed version to discard back to")
    latest = versions[-1]
    reconcile_emitter_to_snapshot(db, emitter, latest.snapshot)
    checkout_service.release_checkout(emitter)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.discard,
        entity_type=AuditEntityType.emitter.value,
        entity_id=emitter.id,
        summary=f"Discarded uncommitted changes on Emitter '{emitter.name}' (back to version {latest.version_number})",
        emitter_id=emitter.id,
    )
    db.commit()
    db.refresh(emitter)
    return attach_emitter_summaries(db, [emitter])[0]


@router.get("/{emitter_id}/notes", response_model=list[EmitterNoteOut])
def list_emitter_notes(
    emitter_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[EmitterNote]:
    """Newest-first analyst commentary log — see EmitterNote."""
    _get_emitter_or_404(db, emitter_id)
    return (
        db.query(EmitterNote)
        .options(joinedload(EmitterNote.author))
        .filter(EmitterNote.emitter_id == emitter_id)
        .order_by(EmitterNote.created_at.desc())
        .all()
    )


@router.post(
    "/{emitter_id}/notes",
    response_model=EmitterNoteOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def create_emitter_note(
    emitter_id: UUID,
    payload: EmitterNoteCreate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> EmitterNote:
    emitter = _get_emitter_or_404(db, emitter_id)
    note = EmitterNote(emitter_id=emitter_id, author_id=user.id, body=payload.body)
    db.add(note)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.emitter_note.value,
        entity_id=note.id,
        summary=f"Added a note to Emitter '{emitter.name}'",
        emitter_id=emitter_id,
    )
    db.commit()
    db.refresh(note)
    return note


@router.delete(
    "/{emitter_id}/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)]
)
def delete_emitter_note(
    emitter_id: UUID,
    note_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> None:
    emitter = _get_emitter_or_404(db, emitter_id)
    note = db.get(EmitterNote, note_id)
    if note is None or note.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found")
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.emitter_note.value,
        entity_id=note.id,
        summary=f"Deleted a note from Emitter '{emitter.name}'",
        changes=snapshot(note, ["body"]),
        emitter_id=emitter_id,
    )
    db.delete(note)
    db.commit()


@router.get("/{emitter_id}/modes", response_model=list[ModeOut])
def list_emitter_modes(
    emitter_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
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
    return attach_mode_extras(db, modes)


@router.post(
    "/{emitter_id}/modes/batch-edit",
    response_model=ModeBatchEditResult,
    dependencies=[Depends(verify_csrf)],
)
def batch_edit_modes(
    emitter_id: UUID,
    payload: ModeBatchEditRequest,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> ModeBatchEditResult:
    """Applies a field edit to many Modes at once, all-or-nothing: every
    resulting line is validated before anything is written, so one Mode
    ending up invalid (e.g. a forbidden field for its PRI type) rejects the
    whole batch with a 422 listing every failure, rather than silently
    applying to some and not others.
    """
    _get_emitter_or_404(db, emitter_id)
    planned, errors = plan_batch_edit(db, emitter_id=emitter_id, mode_ids=payload.mode_ids, fields=payload.fields)
    if errors:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=[e.model_dump(mode="json") for e in errors])

    updated_ids = apply_batch_edit(
        db,
        planned=planned,
        derived_from_test_record_ids=payload.derived_from_test_record_ids,
        derived_from_intercept_entry_ids=payload.derived_from_intercept_entry_ids,
        actor_id=user.id,
        emitter_id=emitter_id,
        shift_reason=payload.shift_reason,
    )
    db.commit()
    return ModeBatchEditResult(updated_mode_ids=updated_ids, count=len(updated_ids))


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
    emitter_id: UUID, batch_id: UUID, db: Session = Depends(get_db), user=Depends(require_emitter_checkout())
) -> None:
    """Deletes every Mode this batch generated (cascading their ModeLines), then the batch."""
    _get_emitter_or_404(db, emitter_id)
    batch = db.get(ModeGenerationBatch, batch_id)
    if batch is None or batch.ew_group.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Generation batch not found")
    mode_count = len(batch.modes)
    for mode in list(batch.modes):
        mode_snapshot = snapshot(
            mode, ["name", "pri_type", "notes", "sort_order", "source_id", "function_group_id"]
        )
        if mode.line is not None:
            mode_snapshot["line"] = snapshot(
                mode.line,
                [
                    "rf_min_mhz", "rf_max_mhz", "pw_min_us", "pw_max_us",
                    "rf_range_matching", "pw_range_matching", "pri_range_matching",
                    "rf_delta", "pw_delta", "pri_delta",
                    "pri_min_us", "pri_max_us", "jitter_min_us", "jitter_max_us",
                    "pri_stagger_values_us", "frame_time_delta_us", "explicit_frame_time_us", "type_data",
                ],
            )
        record_audit(
            db,
            actor_id=user.id,
            action=AuditAction.delete,
            entity_type=AuditEntityType.mode.value,
            entity_id=mode.id,
            summary=f"Deleted Mode '{mode.name}' (cascaded from deleting generation batch '{batch.name_prefix}')",
            changes=mode_snapshot,
            emitter_id=emitter_id,
        )
        db.delete(mode)
    db.delete(batch)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.mode_generation_batch.value,
        entity_id=batch.id,
        summary=f"Deleted generation batch '{batch.name_prefix}' ({mode_count} Mode(s))",
        changes=snapshot(batch, ["name_prefix", "ew_group_id", "source_id"]),
        emitter_id=emitter_id,
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
    payload: CommitEmitterVersionRequest,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
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
        emitter_id=emitter.id,
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


@router.get("/{emitter_id}/versions/{version_number}/diff", response_model=EmitterDiffOut)
def diff_emitter_version(
    emitter_id: UUID,
    version_number: int,
    against: int | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> EmitterDiffOut:
    _get_emitter_or_404(db, emitter_id)
    from_version = against if against is not None else version_number - 1
    if from_version < 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No prior version to diff against")
    old = get_version(db, spec=_VERSION_SPEC, entity_id=emitter_id, version_number=from_version)
    new = get_version(db, spec=_VERSION_SPEC, entity_id=emitter_id, version_number=version_number)
    if old is None or new is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "One or both versions not found")
    return EmitterDiffOut(**compute_emitter_diff(old.snapshot, new.snapshot))


@router.get("/{emitter_id}/diff/live", response_model=EmitterDiffOut)
def diff_emitter_live_state(
    emitter_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> EmitterDiffOut:
    """Diffs the Emitter's current live state against its latest committed
    version — what a Discard would throw away, or a Commit would capture.
    Before the first commit there's no baseline, so everything live is
    reported as newly added rather than 404ing — that's exactly what the
    first Commit would capture.
    """
    emitter = _get_emitter_or_404(db, emitter_id)
    versions = list_versions(db, spec=_VERSION_SPEC, entity_id=emitter_id)
    baseline = versions[-1].snapshot if versions else {}
    live_snapshot = build_emitter_snapshot(emitter)
    return EmitterDiffOut(**compute_emitter_diff(baseline, live_snapshot))


@router.post(
    "/{emitter_id}/versions/{version_number}/revert",
    response_model=EmitterVersionOut,
    dependencies=[Depends(verify_csrf)],
)
def revert_emitter_version(
    emitter_id: UUID,
    version_number: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> EmitterVersion:
    """Reconciles live rows to match an older committed version, then commits
    a *new* version documenting the revert — history is never rewritten,
    this behaves like `git revert`, not `git reset`. Claims the checkout if
    it's free; 409s if someone else already holds it.
    """
    emitter = _lock_emitter_for_checkout(db, emitter_id)
    target = get_version(db, spec=_VERSION_SPEC, entity_id=emitter_id, version_number=version_number)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")
    if emitter.forked_at_version_number is not None and version_number <= emitter.forked_at_version_number:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This version predates the fork — its rows belong to the original Emitter, not this one, "
            "so it can't be reverted to directly. Fork from it again instead if you need its content.",
        )
    try:
        checkout_service.start_checkout(emitter, user.id)
    except checkout_service.AlreadyCheckedOutBySomeoneElse as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Checked out by another user (since {emitter.checked_out_at})") from exc

    reconcile_emitter_to_snapshot(db, emitter, target.snapshot)
    change_summary = f"Reverted to version {version_number}"
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.revert,
        entity_type=AuditEntityType.emitter.value,
        entity_id=emitter.id,
        summary=f"Emitter '{emitter.name}': {change_summary}",
        emitter_id=emitter.id,
    )
    snapshot = build_emitter_snapshot(emitter)
    return commit_version(
        db, spec=_VERSION_SPEC, entity_id=emitter.id, snapshot=snapshot, change_summary=change_summary, created_by=user.id
    )


@router.post(
    "/{emitter_id}/versions/{version_number}/fork",
    response_model=EmitterOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def fork_emitter_version(
    emitter_id: UUID,
    version_number: int,
    payload: ForkRequest,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> EmitterOut:
    """Spins a committed version off into a brand-new, fully independent
    Emitter — new UUIDs throughout, starting at status Draft, auto-checked-
    out to the requester. The source Emitter is untouched and doesn't need
    to be checked out.

    The new Emitter's version history isn't blank: every version up to and
    including the one forked from is copied in verbatim (same numbers,
    snapshots, summaries, timestamps), so its history reads as a continuous
    lineage rather than starting over. Those copied versions still carry the
    *source* Emitter's row ids inside their snapshots, though, so they can be
    viewed/diffed but not reverted to directly — see forked_at_version_number
    and revert_emitter_version's guard below.
    """
    source_emitter = _get_emitter_or_404(db, emitter_id)
    source_version = get_version(db, spec=_VERSION_SPEC, entity_id=emitter_id, version_number=version_number)
    if source_version is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")
    if _active_name_taken(db, payload.new_name):
        raise HTTPException(status.HTTP_409_CONFLICT, "Emitter name already exists")

    new_emitter = build_forked_emitter(
        db, source_snapshot=source_version.snapshot, new_name=payload.new_name, created_by=user.id
    )
    new_emitter.forked_from_emitter_id = source_emitter.id
    new_emitter.forked_from_version_id = source_version.id
    new_emitter.forked_at_version_number = version_number
    checkout_service.start_checkout(new_emitter, user.id)
    db.flush()

    prior_versions = [
        v for v in list_versions(db, spec=_VERSION_SPEC, entity_id=source_emitter.id) if v.version_number <= version_number
    ]
    for v in prior_versions:
        db.add(
            EmitterVersion(
                emitter_id=new_emitter.id,
                version_number=v.version_number,
                snapshot=v.snapshot,
                change_summary=v.change_summary,
                created_by=v.created_by,
                created_at=v.created_at,
            )
        )
    db.flush()

    fork_summary = f"Forked from Emitter '{source_emitter.name}' version {version_number}"
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.fork,
        entity_type=AuditEntityType.emitter.value,
        entity_id=new_emitter.id,
        summary=f"Created Emitter '{new_emitter.name}' — {fork_summary}",
        emitter_id=new_emitter.id,
    )
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.fork,
        entity_type=AuditEntityType.emitter.value,
        entity_id=source_emitter.id,
        summary=f"Forked into new Emitter '{new_emitter.name}' from version {version_number}",
        emitter_id=source_emitter.id,
    )

    snapshot = build_emitter_snapshot(new_emitter)
    commit_version(
        db,
        spec=_VERSION_SPEC,
        entity_id=new_emitter.id,
        snapshot=snapshot,
        change_summary=fork_summary,
        created_by=user.id,
    )
    db.refresh(new_emitter)
    return attach_emitter_summaries(db, [new_emitter])[0]


@router.post("/{emitter_id}/export/xml")
def export_emitter_xml(
    emitter_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> Response:
    """Exports the emitter and its components to an XML-compatible ZIP archive."""
    emitter = _get_emitter_or_404(db, emitter_id)
    exporter = XMLExporterService(db)

    zip_buffer = exporter.export_emitter_to_zip(emitter_id)

    return Response(
        content=zip_buffer.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": attachment_disposition(f"{sanitize_filename(emitter.name)}_xml_export.zip")
        }
    )


@router.post("/{emitter_id}/status", response_model=EmitterVersionOut, dependencies=[Depends(verify_csrf)])
def transition_emitter_status(
    emitter_id: UUID,
    payload: StatusTransitionRequest,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> EmitterVersion:
    emitter = _get_emitter_or_404(db, emitter_id)
    try:
        new_status = EmitterStatus(payload.new_status)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown status '{payload.new_status}'") from exc

    try:
        validate_transition(emitter.status.value, new_status.value, EMITTER_STATUS_TRANSITIONS)
    except InvalidStatusTransition as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc

    # Operational -> Needs rework is a claim that something concrete is
    # wrong with previously-validated data — require the note explaining
    # what, so the regression is traceable later instead of just a bare
    # status flip.
    if emitter.status == EmitterStatus.validated and new_status == EmitterStatus.deprecated and not payload.note:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "A note explaining what needs rework is required when moving from Operational to Needs rework",
        )
    # Mirror of the guard above: declaring something Operational is the one
    # status change everything downstream (Platforms/MDFs pinning this
    # Emitter) treats as a trust signal, so it gets the same required-message
    # treatment as a manual Commit Version — folded into this same request/
    # note rather than a second prompt.
    if new_status == EmitterStatus.validated and not payload.note:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "A message describing what was validated is required when moving to Operational",
        )

    old_status = emitter.status.value
    if new_status == EmitterStatus.deprecated:
        emitter.rework_note = payload.note
    elif emitter.status == EmitterStatus.deprecated:
        emitter.rework_note = None
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
        changes={"status": {"old": old_status, "new": new_status.value}},
        emitter_id=emitter.id,
    )

    snapshot = build_emitter_snapshot(emitter)
    return commit_version(
        db, spec=_VERSION_SPEC, entity_id=emitter.id, snapshot=snapshot, change_summary=summary, created_by=user.id
    )
