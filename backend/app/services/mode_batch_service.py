"""Validate-then-commit engine behind batch-editing many Modes at once (see
app.routers.emitters::batch_edit_modes). All-or-nothing: `plan_batch_edit`
never writes anything, it only computes what *would* change and validates
each resulting line; the caller only proceeds to `apply_batch_edit` if the
error list comes back empty.
"""

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.enums import AuditAction, AuditEntityType, TestRecordModeLinkType
from app.dsl.exceptions import DslSyntaxError
from app.dsl.renderer import render_mode_line
from app.models.ew_group import EwGroup
from app.models.function_group import FunctionGroup
from app.models.intercept import InterceptEntry, InterceptEntryMode
from app.models.mode import Mode
from app.models.test_record import TestRecord, TestRecordMode
from app.schemas.mode import (
    BatchModeFieldEdit,
    ModeBatchEditError,
    ModeLineFields,
    validate_pri_type_fields,
)
from app.services.audit_service import apply_and_diff, record_audit

# ModeLineFields columns that aren't part of the rendered DSL line text —
# kept in sync with the same set in app/routers/modes.py.
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

_LINE_FIELD_KEYS = {
    "rf_range_matching",
    "pw_range_matching",
    "pri_range_matching",
    "rf_delta",
    "pw_delta",
    "pri_delta",
    "frame_time_delta_us",
}
_METADATA_FIELD_KEYS = {"ew_group_id", "function_group_id", "notes"}

# Each *_shift field is applied to exactly one bound, independently of its
# pair — e.g. rf_min_shift never touches rf_max_mhz. A shift on a bound the
# Mode doesn't currently have (e.g. pri_min_shift on a Stagger-PRI Mode,
# where pri_min_us is null) is a silent no-op — there's nothing to shift.
_SHIFT_TARGET_FIELDS = {
    "rf_min_shift": "rf_min_mhz",
    "rf_max_shift": "rf_max_mhz",
    "pw_min_shift": "pw_min_us",
    "pw_max_shift": "pw_max_us",
    "pri_min_shift": "pri_min_us",
    "pri_max_shift": "pri_max_us",
}


@dataclass
class PlannedModeEdit:
    mode: Mode
    metadata_changes: dict[str, Any]
    line_fields: ModeLineFields


def _current_line_values(mode: Mode) -> dict[str, Any]:
    line = mode.line
    return {
        "rf_min_mhz": float(line.rf_min_mhz),
        "rf_max_mhz": float(line.rf_max_mhz),
        "pw_min_us": float(line.pw_min_us),
        "pw_max_us": float(line.pw_max_us),
        "rf_range_matching": line.rf_range_matching,
        "pw_range_matching": line.pw_range_matching,
        "pri_range_matching": line.pri_range_matching,
        "rf_delta": float(line.rf_delta) if line.rf_delta is not None else None,
        "pw_delta": float(line.pw_delta) if line.pw_delta is not None else None,
        "pri_delta": float(line.pri_delta) if line.pri_delta is not None else None,
        "pri_min_us": float(line.pri_min_us) if line.pri_min_us is not None else None,
        "pri_max_us": float(line.pri_max_us) if line.pri_max_us is not None else None,
        "jitter_min_us": float(line.jitter_min_us) if line.jitter_min_us is not None else None,
        "jitter_max_us": float(line.jitter_max_us) if line.jitter_max_us is not None else None,
        "pri_stagger_values_us": [float(v) for v in line.pri_stagger_values_us] if line.pri_stagger_values_us else None,
        "frame_time_delta_us": float(line.frame_time_delta_us) if line.frame_time_delta_us is not None else None,
        "type_data": line.type_data,
    }


def plan_batch_edit(
    db: Session,
    *,
    emitter_id: UUID,
    mode_ids: list[UUID],
    fields: BatchModeFieldEdit,
) -> tuple[list[PlannedModeEdit], list[ModeBatchEditError]]:
    modes = (
        db.query(Mode)
        .join(EwGroup, Mode.ew_group_id == EwGroup.id)
        .filter(Mode.id.in_(mode_ids), EwGroup.emitter_id == emitter_id)
        .all()
    )
    found_ids = {m.id for m in modes}
    missing = set(mode_ids) - found_ids
    if missing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Mode id(s) not found in this Emitter: {missing}")

    field_data = fields.model_dump(exclude_unset=True)

    if "ew_group_id" in field_data:
        target = db.get(EwGroup, field_data["ew_group_id"])
        if target is None or target.emitter_id != emitter_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Target EW Group not found in this Emitter")

    if field_data.get("function_group_id") is not None:
        target_fg = db.get(FunctionGroup, field_data["function_group_id"])
        if target_fg is None or target_fg.emitter_id != emitter_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Target Function Group not found in this Emitter")

    planned: list[PlannedModeEdit] = []
    errors: list[ModeBatchEditError] = []

    for mode in modes:
        try:
            values = _current_line_values(mode)
            for key, value in field_data.items():
                if key in _LINE_FIELD_KEYS:
                    values[key] = value
                elif key in _SHIFT_TARGET_FIELDS and value is not None:
                    target = _SHIFT_TARGET_FIELDS[key]
                    if values.get(target) is not None:
                        values[target] = values[target] + value

            new_line = ModeLineFields(**values)
            validate_pri_type_fields(mode.pri_type, new_line)

            metadata_changes = {k: v for k, v in field_data.items() if k in _METADATA_FIELD_KEYS}
            planned.append(PlannedModeEdit(mode=mode, metadata_changes=metadata_changes, line_fields=new_line))
        except (ValidationError, ValueError) as exc:
            errors.append(ModeBatchEditError(mode_id=mode.id, mode_name=mode.name, error=str(exc)))

    return planned, errors


def apply_batch_edit(
    db: Session,
    *,
    planned: list[PlannedModeEdit],
    derived_from_test_record_ids: list[UUID],
    derived_from_intercept_entry_ids: list[UUID] = [],
    actor_id: UUID | None,
    emitter_id: UUID,
    shift_reason: str | None = None,
) -> list[UUID]:
    if derived_from_test_record_ids:
        found_ids = {r.id for r in db.query(TestRecord.id).filter(TestRecord.id.in_(derived_from_test_record_ids)).all()}
        missing = set(derived_from_test_record_ids) - found_ids
        if missing:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown test record id(s): {missing}")
    if derived_from_intercept_entry_ids:
        found_ids = {
            e.id
            for e in db.query(InterceptEntry.id).filter(InterceptEntry.id.in_(derived_from_intercept_entry_ids)).all()
        }
        missing = set(derived_from_intercept_entry_ids) - found_ids
        if missing:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown intercept entry id(s): {missing}")

    updated_ids: list[UUID] = []
    for item in planned:
        mode = item.mode
        changes = apply_and_diff(mode, item.metadata_changes)
        line_fields = item.line_fields.model_dump()
        changes.update(apply_and_diff(mode.line, line_fields))
        try:
            mode.line.dsl_text = render_mode_line(
                pri_type=mode.pri_type, **{k: v for k, v in line_fields.items() if k not in _NON_DSL_LINE_FIELDS}
            )
        except DslSyntaxError:
            mode.line.dsl_text = None

        for test_record_id in derived_from_test_record_ids:
            db.add(
                TestRecordMode(test_record_id=test_record_id, mode_id=mode.id, link_type=TestRecordModeLinkType.derived)
            )
        for intercept_entry_id in derived_from_intercept_entry_ids:
            db.add(InterceptEntryMode(intercept_entry_id=intercept_entry_id, mode_id=mode.id))

        summary = f"Batch-updated Mode '{mode.name}'"
        if shift_reason:
            summary += f" — {shift_reason}"
        record_audit(
            db,
            actor_id=actor_id,
            action=AuditAction.update,
            entity_type=AuditEntityType.mode.value,
            entity_id=mode.id,
            summary=summary,
            changes=changes,
            emitter_id=emitter_id,
        )
        updated_ids.append(mode.id)

    return updated_ids
