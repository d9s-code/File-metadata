from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role, TestRecordModeLinkType
from app.database import get_db
from app.deps import require_ew_group_checkout, require_role
from app.dsl.exceptions import DslSyntaxError
from app.dsl.renderer import render_mode_line
from app.models.ew_group import EwGroup
from app.models.mode import Mode, ModeLine
from app.models.source import Source
from app.models.test_record import TestRecord, TestRecordMode
from app.schemas.mode import (
    ModeCreate,
    ModeCreateFromDsl,
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
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> list[ModeOut]:
    _get_ew_group_or_404(db, ew_group_id)
    modes = db.query(Mode).filter(Mode.ew_group_id == ew_group_id).order_by(Mode.sort_order).all()
    return attach_mode_extras(db, modes)


@router.post(
    "", response_model=ModeOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)]
)
def create_mode(
    ew_group_id: UUID,
    payload: ModeCreate,
    db: Session = Depends(get_db),
    user=Depends(require_ew_group_checkout()),
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
    user=Depends(require_ew_group_checkout()),
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
    user=Depends(require_ew_group_checkout()),
) -> Mode:
    mode = db.get(Mode, mode_id)
    if mode is None or mode.ew_group_id != ew_group_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mode not found")

    data = payload.model_dump(exclude_unset=True, exclude={"line", "derived_from_test_record_ids"})
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
        _link_derived_test_records(db, mode_id=mode.id, test_record_ids=payload.derived_from_test_record_ids)

    summary = f"Updated Mode '{mode.name}'"
    if payload.line is not None and payload.derived_from_test_record_ids:
        summary += f" (test-derived, {len(payload.derived_from_test_record_ids)} test record(s))"
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.mode.value,
        entity_id=mode.id,
        summary=summary,
        changes=changes,
        emitter_id=mode.source.emitter_id,
    )
    db.commit()
    db.refresh(mode)
    return mode


@router.delete("/{mode_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_mode(
    ew_group_id: UUID,
    mode_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_ew_group_checkout()),
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
