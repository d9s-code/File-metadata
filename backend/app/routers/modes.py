from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, ModeStatus, Role, TestRecordModeLinkType
from app.database import get_db
from app.deps import require_role
from app.dsl.exceptions import DslSyntaxError
from app.dsl.renderer import render_mode_line
from app.models.ew_group import EwGroup
from app.models.mode import Mode, ModeLine
from app.models.source import Source
from app.models.test_record import TestRecord, TestRecordMode
from app.schemas.mode import (
    ModeCreate,
    ModeCreateFromDsl,
    ModeDraftCreate,
    ModeOut,
    ModeUpdate,
    require_manual_deltas,
    validate_pri_type_fields,
)
from app.services.audit_service import apply_and_diff, record_audit
from app.services.dsl_mode_service import create_mode_from_dsl
from app.services.mode_test_status_service import attach_mode_extras

router = APIRouter(prefix="/ew-groups/{ew_group_id}/modes", tags=["modes"])

# ModeLineFields columns that aren't part of the rendered DSL line text.
_NON_DSL_LINE_FIELDS = {
    "type_data",
    "rf_delta",
    "pw_delta",
    "pri_delta",
    "frame_time_delta_us",
    "rf_range_matching",
    "pw_range_matching",
    "pri_range_matching",
}

# Statuses shown by default — a pending draft is worth seeing alongside the
# live set (it's what it would replace), but a superseded/rejected Mode is
# closed history, hidden unless include_history=true is passed.
_DEFAULT_VISIBLE_STATUSES = [ModeStatus.approved, ModeStatus.draft]


def _get_ew_group_or_404(db: Session, ew_group_id: UUID) -> EwGroup:
    ew_group = db.get(EwGroup, ew_group_id)
    if ew_group is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "EW Group not found")
    return ew_group


def _link_derived_test_records(db: Session, *, mode_id: UUID, test_record_ids: list[UUID]) -> None:
    if not test_record_ids:
        return
    found_ids = {r.id for r in db.query(TestRecord.id).filter(TestRecord.id.in_(test_record_ids)).all()}
    missing = set(test_record_ids) - found_ids
    if missing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown test record id(s): {missing}")
    for test_record_id in test_record_ids:
        db.add(TestRecordMode(test_record_id=test_record_id, mode_id=mode_id, link_type=TestRecordModeLinkType.derived))


@router.get("", response_model=list[ModeOut])
def list_modes(
    ew_group_id: UUID,
    include_history: bool = False,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> list[ModeOut]:
    _get_ew_group_or_404(db, ew_group_id)
    query = db.query(Mode).filter(Mode.ew_group_id == ew_group_id)
    if not include_history:
        query = query.filter(Mode.status.in_(_DEFAULT_VISIBLE_STATUSES))
    modes = query.order_by(Mode.sort_order).all()
    return attach_mode_extras(db, modes)


@router.post(
    "", response_model=ModeOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)]
)
def create_mode(
    ew_group_id: UUID,
    payload: ModeCreate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> Mode:
    ew_group = _get_ew_group_or_404(db, ew_group_id)
    source = db.get(Source, payload.source_id)
    if source is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found")
    if source.emitter_id != ew_group.emitter_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Source and EW Group must belong to the same Emitter",
        )

    mode = Mode(
        ew_group_id=ew_group_id,
        source_id=payload.source_id,
        name=payload.name,
        pri_type=payload.pri_type,
        notes=payload.notes,
        sort_order=payload.sort_order,
    )
    db.add(mode)
    db.flush()

    line_fields = payload.line.model_dump()
    try:
        dsl_text = render_mode_line(
            pri_type=payload.pri_type, **{k: v for k, v in line_fields.items() if k not in _NON_DSL_LINE_FIELDS}
        )
    except DslSyntaxError:
        dsl_text = None  # e.g. Xlet, which has no DSL line syntax yet
    line = ModeLine(mode_id=mode.id, dsl_text=dsl_text, **line_fields)
    db.add(line)
    _link_derived_test_records(db, mode_id=mode.id, test_record_ids=payload.derived_from_test_record_ids)
    summary = f"Created Mode '{mode.name}'"
    if payload.derived_from_test_record_ids:
        summary += f" (test-derived, {len(payload.derived_from_test_record_ids)} test record(s))"
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.mode.value,
        entity_id=mode.id,
        summary=summary,
        changes=payload.model_dump(mode="json"),
        emitter_id=ew_group.emitter_id,
    )
    db.commit()
    db.refresh(mode)
    return mode


@router.post(
    "/from-dsl",
    response_model=ModeOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def create_mode_from_dsl_text(
    ew_group_id: UUID,
    payload: ModeCreateFromDsl,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> Mode:
    """The 'write a mode line explicitly' path: parses the DSL text into a
    Mode + ModeLine directly, and derives/upserts matching elements into the
    Source's element pool — the reverse direction of the elements/cartesian
    workflow.
    """
    ew_group = _get_ew_group_or_404(db, ew_group_id)
    source = db.get(Source, payload.source_id)
    if source is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found")
    if source.emitter_id != ew_group.emitter_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Source and EW Group must belong to the same Emitter",
        )
    try:
        mode = create_mode_from_dsl(
            db,
            source=source,
            ew_group_id=ew_group_id,
            name=payload.name,
            dsl_text=payload.dsl_text,
            notes=payload.notes,
            sort_order=payload.sort_order,
        )
    except DslSyntaxError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.mode.value,
        entity_id=mode.id,
        summary=f"Created Mode '{mode.name}' from a typed DSL line",
        changes={"dsl_text": payload.dsl_text},
        emitter_id=ew_group.emitter_id,
    )
    db.commit()
    return mode


@router.patch("/{mode_id}", response_model=ModeOut, dependencies=[Depends(verify_csrf)])
def update_mode(
    ew_group_id: UUID,
    mode_id: UUID,
    payload: ModeUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> Mode:
    mode = db.get(Mode, mode_id)
    if mode is None or mode.ew_group_id != ew_group_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mode not found")
    if mode.status in (ModeStatus.superseded, ModeStatus.rejected):
        raise HTTPException(status.HTTP_409_CONFLICT, f"A {mode.status.value} Mode is read-only history")
    if payload.line is not None and mode.status == ModeStatus.approved:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "An approved Mode's line can't be edited directly — propose a draft edit "
            "(POST .../modes/{mode_id}/draft) instead, which supersedes it on approval",
        )

    data = payload.model_dump(exclude_unset=True, exclude={"line"})
    if "ew_group_id" in data:
        new_ew_group = db.get(EwGroup, data["ew_group_id"])
        if new_ew_group is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Target EW Group not found")
        if new_ew_group.emitter_id != mode.source.emitter_id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Target EW Group must belong to the same Emitter as the Mode's Source",
            )
    changes = apply_and_diff(mode, data)

    if payload.line is not None:
        validate_pri_type_fields(mode.pri_type, payload.line)
        require_manual_deltas(mode.pri_type, payload.line)
        line_fields = payload.line.model_dump()
        changes.update(apply_and_diff(mode.line, line_fields))
        try:
            mode.line.dsl_text = render_mode_line(
                pri_type=mode.pri_type, **{k: v for k, v in line_fields.items() if k not in _NON_DSL_LINE_FIELDS}
            )
        except DslSyntaxError:
            mode.line.dsl_text = None

    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.mode.value,
        entity_id=mode.id,
        summary=f"Updated Mode '{mode.name}'",
        changes=changes,
        emitter_id=mode.source.emitter_id,
    )
    db.commit()
    db.refresh(mode)
    return mode


@router.post(
    "/{mode_id}/draft",
    response_model=ModeOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def propose_mode_draft(
    ew_group_id: UUID,
    mode_id: UUID,
    payload: ModeDraftCreate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> Mode:
    """Proposes a line edit to an `approved` Mode as a new `draft` Mode that
    supersedes it once approved. See ModeStatus.
    """
    original = db.get(Mode, mode_id)
    if original is None or original.ew_group_id != ew_group_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mode not found")
    if original.status != ModeStatus.approved:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Only an approved Mode can be drafted against (this one is {original.status.value})"
        )
    if db.query(Mode).filter(Mode.supersedes_id == original.id, Mode.status == ModeStatus.draft).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This Mode already has a pending draft edit")

    draft = Mode(
        ew_group_id=original.ew_group_id,
        source_id=original.source_id,
        name=original.name,
        pri_type=payload.pri_type,
        notes=original.notes,
        sort_order=original.sort_order,
        status=ModeStatus.draft,
        supersedes_id=original.id,
    )
    db.add(draft)
    db.flush()

    line_fields = payload.line.model_dump()
    try:
        dsl_text = render_mode_line(
            pri_type=payload.pri_type, **{k: v for k, v in line_fields.items() if k not in _NON_DSL_LINE_FIELDS}
        )
    except DslSyntaxError:
        dsl_text = None
    db.add(ModeLine(mode_id=draft.id, dsl_text=dsl_text, **line_fields))
    _link_derived_test_records(db, mode_id=draft.id, test_record_ids=payload.derived_from_test_record_ids)

    summary = f"Proposed a draft edit to Mode '{original.name}'"
    if payload.derived_from_test_record_ids:
        summary += f" (test-derived, {len(payload.derived_from_test_record_ids)} test record(s))"
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.mode.value,
        entity_id=draft.id,
        summary=summary,
        changes=payload.model_dump(mode="json"),
        emitter_id=original.source.emitter_id,
    )
    db.commit()
    db.refresh(draft)
    return draft


@router.post("/{mode_id}/approve", response_model=ModeOut, dependencies=[Depends(verify_csrf)])
def approve_mode_draft(
    ew_group_id: UUID,
    mode_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> Mode:
    """Approves a draft Mode edit: the draft becomes `approved`, and the Mode
    it targeted becomes `superseded` — kept permanently for lineage, excluded
    from active views/ambiguity checks/XML export from then on.
    """
    draft = db.get(Mode, mode_id)
    if draft is None or draft.ew_group_id != ew_group_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mode not found")
    if draft.status != ModeStatus.draft or draft.supersedes_id is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a pending draft edit can be approved")
    original = db.get(Mode, draft.supersedes_id)
    if original is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "The Mode this draft would supersede no longer exists")

    draft.status = ModeStatus.approved
    original.status = ModeStatus.superseded
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.status_change,
        entity_type=AuditEntityType.mode.value,
        entity_id=draft.id,
        summary=f"Approved a draft edit to Mode '{draft.name}' — now supersedes the prior version",
        changes={"status": {"old": ModeStatus.draft.value, "new": ModeStatus.approved.value}},
        emitter_id=draft.source.emitter_id,
    )
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.status_change,
        entity_type=AuditEntityType.mode.value,
        entity_id=original.id,
        summary=f"Mode '{original.name}' superseded by an approved draft edit",
        changes={"status": {"old": ModeStatus.approved.value, "new": ModeStatus.superseded.value}},
        emitter_id=original.source.emitter_id,
    )
    db.commit()
    db.refresh(draft)
    return draft


@router.post("/{mode_id}/reject", response_model=ModeOut, dependencies=[Depends(verify_csrf)])
def reject_mode_draft(
    ew_group_id: UUID,
    mode_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> Mode:
    """Rejects a draft Mode edit — the Mode it targeted is never touched and
    stays approved. The draft itself is kept (status `rejected`), not deleted.
    """
    draft = db.get(Mode, mode_id)
    if draft is None or draft.ew_group_id != ew_group_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mode not found")
    if draft.status != ModeStatus.draft:
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a pending draft edit can be rejected")

    draft.status = ModeStatus.rejected
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.status_change,
        entity_type=AuditEntityType.mode.value,
        entity_id=draft.id,
        summary=f"Rejected a draft edit to Mode '{draft.name}'",
        changes={"status": {"old": ModeStatus.draft.value, "new": ModeStatus.rejected.value}},
        emitter_id=draft.source.emitter_id,
    )
    db.commit()
    db.refresh(draft)
    return draft


@router.delete("/{mode_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_mode(
    ew_group_id: UUID,
    mode_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> None:
    mode = db.get(Mode, mode_id)
    if mode is None or mode.ew_group_id != ew_group_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mode not found")
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.mode.value,
        entity_id=mode.id,
        summary=f"Deleted Mode '{mode.name}'",
        emitter_id=mode.source.emitter_id,
    )
    db.delete(mode)
    db.commit()
