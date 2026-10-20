from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.config import settings
from app.core.csrf import verify_csrf
from app.core.downloads import attachment_disposition
from app.core.enums import (
    AuditAction,
    AuditEntityType,
    EmitterStatus,
    Role,
    TestScopeType,
)
from app.database import get_db
from app.services import milestones, statuses
from app.deps import require_emitter_checkout, require_role
from app.models.emitter import Emitter
from app.models.emitter_note import EmitterNote
from app.models.emitter_version import EmitterVersion
from app.models.ew_group import EwGroup
from app.models.mode import Mode, ModeGenerationBatch
from app.routers.modes import create_mode_record, delete_mode_audited
from app.models.test_record import TestRecord, TestRecordLine, TestRecordLineMode, TestRecordMode
from app.models.user import User
from app.schemas.emitter import (
    EmitterBulkAction,
    EmitterBulkOut,
    EmitterBulkResult,
    EmitterCheckoutOut,
    EmitterCreate,
    EmitterOut,
    EmitterUpdate,
)
from app.schemas.emitter_note import EmitterNoteCreate, EmitterNoteOut
from app.schemas.task import EmitterAssign
from app.schemas.mode_element import ElementCoverageOut, ElementOverviewRow
from app.services.element_coverage import element_coverage
from app.services.element_overview import element_overview
from app.services.emitter_compare import compare_emitters
from app.schemas.mode import (
    ParameterAcrossModes,
    ParameterAcrossModesCreate,
    ParameterAddResult,
    ParameterPlanOut,
    ModeBatchDeleteRequest,
    ModeBatchDeleteResult,
    ModeBatchEditRequest,
    ModeBatchEditResult,
    ModeGenerationBatchOut,
    ModeOut,
)
from app.schemas.emitter_version import (
    CommitEmitterVersionRequest,
    EmitterDiffOut,
    EmitterVersionDetailOut,
    EmitterVersionOut,
    ForkRequest,
    RevertPreviewOut,
    StatusTransitionRequest,
)
from app.routers.tasks import active_user
from app.services import checkout_service
from app.services.audit_service import apply_and_diff, record_audit, snapshot
from app.services.emitter_diff_service import compute_emitter_diff
from app.services.emitter_revert_service import build_forked_emitter, reconcile_emitter_to_snapshot
from app.services.emitter_summary_service import attach_emitter_summaries
from app.services import mode_parameter_service
from app.services.mode_batch_service import apply_batch_edit, plan_batch_edit
from app.services.mode_test_status_service import attach_mode_extras
from app.services.snapshots import build_emitter_snapshot
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


@router.get("/compare")
def compare_two_emitters(
    a: UUID,
    b: UUID,
    a_version: int | None = None,
    b_version: int | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> dict:
    """Two Emitters side by side, each as of a saved version (the latest unless
    given): what each covers, and every pair of their Modes the ambiguity
    check would flag. Declared before /{emitter_id}."""
    return compare_emitters(db, a, b, a_version, b_version)


@router.get("/checkouts", response_model=list[EmitterCheckoutOut])
def list_checkouts(db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> list[EmitterCheckoutOut]:
    """Every Emitter someone is holding for editing, longest-held first —
    small enough to poll for the "you're still editing" reminder. Declared
    before /{emitter_id} so "checkouts" isn't read as an id. Locks untouched
    for CHECKOUT_RELEASE_DAYS are released first."""
    checkout_service.release_stale_checkouts(db)
    rows = (
        db.query(Emitter, User.username)
        .outerjoin(User, User.id == Emitter.checked_out_by_id)
        .filter(Emitter.checked_out_by_id.is_not(None), Emitter.is_deleted.is_(False))
        .order_by(Emitter.checked_out_at.asc().nulls_last(), Emitter.name)
        .all()
    )
    activity = checkout_service.last_activity(db, [e for e, _ in rows])
    now = datetime.now(timezone.utc)
    warn_after = timedelta(days=settings.checkout_warn_days)
    release_after = timedelta(days=settings.checkout_release_days) if settings.checkout_release_days > 0 else None
    return [
        EmitterCheckoutOut(
            emitter_id=e.id,
            emitter_name=e.name,
            checked_out_by_id=e.checked_out_by_id,
            checked_out_by_username=username,
            checked_out_at=e.checked_out_at,
            last_activity_at=activity.get(e.id),
            stale=activity.get(e.id) is not None and now - activity[e.id] >= warn_after,
            releases_at=activity[e.id] + release_after if release_after and e.id in activity else None,
        )
        for e, username in rows
    ]


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


@router.put("/{emitter_id}/assignee", response_model=EmitterOut, dependencies=[Depends(verify_csrf)])
def assign_emitter(
    emitter_id: UUID,
    payload: EmitterAssign,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.editor)),
) -> EmitterOut:
    """Who's responsible for this Emitter (null: nobody). Not part of its saved
    versions, so it needs no edit lock — anyone who can edit may (re)assign it."""
    emitter = db.get(Emitter, emitter_id)
    if emitter is None or emitter.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    assignee = active_user(db, payload.assignee_id, editors_only=True)
    if payload.assignee_id != emitter.assignee_id:
        old = db.get(User, emitter.assignee_id) if emitter.assignee_id else None
        emitter.assignee_id = payload.assignee_id
        record_audit(
            db,
            actor_id=user.id,
            action=AuditAction.update,
            entity_type=AuditEntityType.emitter.value,
            entity_id=emitter.id,
            summary=(
                f"Assigned Emitter '{emitter.name}' to {assignee.username}" if assignee
                else f"Unassigned Emitter '{emitter.name}'"
            ),
            changes={"assignee": {"old": old.username if old else None, "new": assignee.username if assignee else None}},
            emitter_id=emitter.id,
        )
        db.commit()
        db.refresh(emitter)
    return attach_emitter_summaries(db, [emitter])[0]


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
    holder_id = emitter.checked_out_by_id
    forced = holder_id != user.id
    holder = db.get(User, holder_id) if forced else None
    checkout_service.release_checkout(emitter)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.checkin,
        entity_type=AuditEntityType.emitter.value,
        entity_id=emitter.id,
        summary=(
            f"Force-released {holder.username if holder else 'another user'}'s edit lock on Emitter '{emitter.name}'"
            if forced
            else f"Stopped editing Emitter '{emitter.name}' — edit lock released"
        ),
        changes={"released_holder_id": str(holder_id)} if forced else None,
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
        .options(selectinload(Mode.source), selectinload(Mode.extra_source_links))
        .all()
    )
    return attach_mode_extras(db, modes)


@router.post("/{emitter_id}/modes/add-parameter/plan", response_model=ParameterPlanOut)
def plan_parameter_across_modes(
    emitter_id: UUID,
    payload: ParameterAcrossModes,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.editor)),
) -> dict:
    """The combinations of the other two parameters among the Emitter's
    Modes that a value could be added to — see mode_parameter_service."""
    _get_emitter_or_404(db, emitter_id)
    try:
        rows = mode_parameter_service.plan(db, emitter_id, payload.parameter, payload.values, payload.pri_type)
    except mode_parameter_service.ParameterError as err:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(err)) from err
    return {
        "value": mode_parameter_service.value_text(payload.parameter, payload.pri_type, payload.values),
        "rows": rows,
    }


@router.post(
    "/{emitter_id}/modes/add-parameter",
    response_model=ParameterAddResult,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def add_parameter_across_modes(
    emitter_id: UUID,
    payload: ParameterAcrossModesCreate,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> dict:
    """One new Mode per picked combination, with the value — all or none,
    in one generation batch per EW Group (so they can be deleted together)."""
    try:
        created, skipped = mode_parameter_service.add(
            db,
            emitter_id,
            parameter=payload.parameter,
            values=payload.values,
            pri_type=payload.pri_type,
            row_keys=payload.row_keys,
            name_suffix=payload.name_suffix.strip(),
            extra_source_ids=payload.extra_source_ids,
            derived_from_test_record_id=payload.derived_from_test_record_id,
            actor_id=user.id,
            create_mode=create_mode_record,
        )
    except mode_parameter_service.ParameterError as err:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(err)) from err
    db.commit()
    for mode in created:
        db.refresh(mode)
    return {"created": attach_mode_extras(db, created), "skipped": skipped}


@router.post(
    "/{emitter_id}/modes/batch-delete",
    response_model=ModeBatchDeleteResult,
    dependencies=[Depends(verify_csrf)],
)
def batch_delete_modes(
    emitter_id: UUID,
    payload: ModeBatchDeleteRequest,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> ModeBatchDeleteResult:
    """Deletes the given Modes of this Emitter, all or none: one that isn't
    the Emitter's refuses the lot. Each is in the Audit Log, whole, and a
    discard brings them back until the Emitter is saved."""
    ids = list(dict.fromkeys(payload.mode_ids))
    modes = (
        db.query(Mode)
        .join(EwGroup, Mode.ew_group_id == EwGroup.id)
        .filter(Mode.id.in_(ids), EwGroup.emitter_id == emitter_id)
        .all()
    )
    if len(modes) != len(ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{len(ids) - len(modes)} of the Modes aren't this Emitter's")
    for mode in modes:
        delete_mode_audited(db, user.id, mode)
    db.commit()
    return ModeBatchDeleteResult(deleted_mode_ids=[m.id for m in modes], count=len(modes))


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


@router.get("/{emitter_id}/element-overview", response_model=list[ElementOverviewRow])
def get_element_overview(
    emitter_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> list[dict]:
    """Every distinct Element across the Emitter's Sources, with where each is."""
    _get_emitter_or_404(db, emitter_id)
    return element_overview(db, emitter_id)


@router.get("/{emitter_id}/element-coverage", response_model=ElementCoverageOut)
def get_element_coverage(
    emitter_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> dict:
    """Which of the Elements in the Emitter's Sources its Modes (and, for scan,
    EW Groups) cover — see element_coverage."""
    _get_emitter_or_404(db, emitter_id)
    return element_coverage(db, emitter_id)


@router.get("/{emitter_id}/generation-batches", response_model=list[ModeGenerationBatchOut])
def list_generation_batches(
    emitter_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[ModeGenerationBatchOut]:
    """Every batch of generated Modes for this Emitter (cartesian-product runs
    and Modes created from an Intercept), across all its EW Groups/Sources.
    Batches with no Modes left — all deleted, or undone by discarding the
    Emitter's changes — aren't listed."""
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
        if b.modes
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
    if batch is None or batch.ew_group is None or batch.ew_group.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Generation batch not found")
    mode_count = len(batch.modes)
    for mode in list(batch.modes):
        mode_snapshot = snapshot(
            mode,
        [
            "name", "pri_type", "notes", "sort_order", "source_id",
            "confirmation_quality", "confirmation_quantity",
        ],
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
    return EmitterDiffOut(**compute_emitter_diff(old.snapshot, new.snapshot, statuses.labels(db, "emitter")))


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
    # Status isn't part of what a save captures or a discard throws away.
    live_snapshot = {**build_emitter_snapshot(emitter), "status": baseline.get("status")}
    return EmitterDiffOut(**compute_emitter_diff(baseline, live_snapshot, statuses.labels(db, "emitter")))


@router.get("/{emitter_id}/versions/{version_number}/revert-preview", response_model=RevertPreviewOut)
def preview_revert(
    emitter_id: UUID,
    version_number: int,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> RevertPreviewOut:
    """What reverting to the version would change, before it's done: the live
    Emitter against that version, the logged results naming what it removes,
    and the unsaved changes it throws away."""
    emitter = _get_emitter_or_404(db, emitter_id)
    target = get_version(db, spec=_VERSION_SPEC, entity_id=emitter_id, version_number=version_number)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")
    live = {**build_emitter_snapshot(emitter), "status": target.snapshot.get("status")}
    diff = compute_emitter_diff(live, target.snapshot, statuses.labels(db, "emitter"))

    target_modes = {m["id"] for g in target.snapshot.get("ew_groups", []) for m in g.get("modes", [])}
    target_lines = {tl["id"] for tl in target.snapshot.get("test_lines", [])}
    gone_modes = [m.id for g in emitter.ew_groups for m in g.modes if str(m.id) not in target_modes]
    gone_lines = [tl.id for tl in emitter.test_lines if str(tl.id) not in target_lines]
    records = db.query(TestRecord.id).filter(
        TestRecord.scope_type == TestScopeType.emitter, TestRecord.scope_id == emitter.id
    )
    naming = 0
    if gone_modes:
        naming += db.query(TestRecordMode).filter(
            TestRecordMode.mode_id.in_(gone_modes), TestRecordMode.test_record_id.in_(records)
        ).count()
        naming += db.query(TestRecordLineMode).join(TestRecordLine).filter(
            TestRecordLineMode.mode_id.in_(gone_modes), TestRecordLine.test_record_id.in_(records)
        ).count()
    if gone_lines:
        naming += db.query(TestRecordLine).filter(
            TestRecordLine.test_line_id.in_(gone_lines), TestRecordLine.test_record_id.in_(records)
        ).count()

    versions = list_versions(db, spec=_VERSION_SPEC, entity_id=emitter_id)
    unsaved = 0
    if versions:
        latest = versions[-1].snapshot
        unsaved = len(
            compute_emitter_diff(latest, {**build_emitter_snapshot(emitter), "status": latest.get("status")})["entries"]
        )
    return RevertPreviewOut(**diff, results_naming_removed=naming, unsaved_changes=unsaved)


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


@router.post("/{emitter_id}/status", response_model=EmitterOut, dependencies=[Depends(verify_csrf)])
def transition_emitter_status(
    emitter_id: UUID,
    payload: StatusTransitionRequest,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> Emitter:
    """Move the Emitter along its lifecycle. Status is where the Emitter
    stands, not part of its content: no checkout is needed (whoever is
    editing keeps their unsaved work), no version is saved for it (the
    Audit Log has it, and the next saved version records it), and discard
    and revert leave it as it is."""
    emitter = db.query(Emitter).filter(Emitter.id == emitter_id).with_for_update().first()
    if emitter is None or emitter.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    target, open_ones = milestones.check_status_move(
        db, "emitter", emitter.id, emitter.status, payload.new_status, payload.note, payload.confirm_unmet
    )

    old_status = emitter.status
    if target.key == EmitterStatus.deprecated:
        emitter.rework_note = payload.note
    elif old_status == EmitterStatus.deprecated:
        emitter.rework_note = None
    emitter.status = target.key
    db.flush()

    summary = f"Status: {statuses.label(db, 'emitter', old_status)} → {target.label}"
    if payload.note:
        summary += f" — {payload.note}"
    summary += milestones.unmet_suffix(open_ones)

    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.status_change,
        entity_type=AuditEntityType.emitter.value,
        entity_id=emitter.id,
        summary=f"Emitter '{emitter.name}': {summary}",
        changes={"status": {"old": old_status, "new": target.key}, "milestones_not_met": open_ones or None},
        emitter_id=emitter.id,
    )

    db.commit()
    db.refresh(emitter)
    return emitter



@router.post("/bulk", response_model=EmitterBulkOut, dependencies=[Depends(verify_csrf)])
def bulk_emitter_action(
    payload: EmitterBulkAction,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.editor)),
) -> EmitterBulkOut:
    """Apply one action to many Emitters. Each goes through the same rules as
    doing it on one Emitter (who may assign, which status moves are allowed,
    who may release a lock), one at a time: those that can't are skipped with
    the reason, and the rest are done."""
    from app.routers.platforms import pin_emitter  # Platforms import Emitters' helpers.
    from app.schemas.platform import PlatformLinkCreate

    if payload.action == "status" and not payload.new_status:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Say which status to move them to")
    if payload.action == "pin" and payload.platform_id is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Say which Platform to pin them into")

    results: list[EmitterBulkResult] = []
    for emitter_id in dict.fromkeys(payload.emitter_ids):
        emitter = db.get(Emitter, emitter_id)
        if emitter is None or emitter.is_deleted:
            results.append(EmitterBulkResult(id=emitter_id, name="(deleted)", ok=False, message="Emitter not found"))
            continue
        name = emitter.name
        try:
            if payload.action == "assign":
                assign_emitter(emitter_id, EmitterAssign(assignee_id=payload.assignee_id), db, user)
                message = "Assigned" if payload.assignee_id else "Unassigned"
            elif payload.action == "status":
                new_name = statuses.label(db, "emitter", payload.new_status)
                if emitter.status == payload.new_status:
                    results.append(EmitterBulkResult(id=emitter_id, name=name, ok=False, message=f"Already {new_name}"))
                    continue
                transition_emitter_status(
                    emitter_id,
                    StatusTransitionRequest(
                        new_status=payload.new_status, note=payload.note, confirm_unmet=payload.confirm_unmet
                    ),
                    db,
                    user,
                )
                message = f"Moved to {new_name}"
            elif payload.action == "pin":
                latest = (
                    db.query(EmitterVersion)
                    .filter(EmitterVersion.emitter_id == emitter_id)
                    .order_by(EmitterVersion.version_number.desc())
                    .first()
                )
                if latest is None:
                    results.append(EmitterBulkResult(id=emitter_id, name=name, ok=False, message="No saved version to pin"))
                    continue
                pin_emitter(
                    payload.platform_id,
                    PlatformLinkCreate(emitter_id=emitter_id, emitter_version_id=latest.id),
                    db,
                    user,
                )
                message = f"Pinned v{latest.version_number}"
            else:
                if emitter.checked_out_by_id is None:
                    results.append(EmitterBulkResult(id=emitter_id, name=name, ok=False, message="Not being edited"))
                    continue
                checkin_emitter(emitter_id, db, user)
                message = "Edit lock released"
        except HTTPException as exc:
            db.rollback()
            detail = exc.detail["message"] if isinstance(exc.detail, dict) else str(exc.detail)
            results.append(EmitterBulkResult(id=emitter_id, name=name, ok=False, message=detail))
            continue
        results.append(EmitterBulkResult(id=emitter_id, name=name, ok=True, message=message))
    done = sum(1 for r in results if r.ok)
    return EmitterBulkOut(done=done, skipped=len(results) - done, results=results)
