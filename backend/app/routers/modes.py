from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role, TestRecordModeLinkType
from app.database import get_db
from app.deps import require_ew_group_checkout, require_role
from app.dsl.exceptions import DslSyntaxError
from app.dsl.renderer import render_mode_line
from app.models.ew_group import EwGroup
from app.models.function_group import FunctionGroup
from app.core.enums import PriType
from app.models.intercept import Intercept, InterceptEntry, InterceptEntryMode
from app.models.mode import Mode, ModeGenerationBatch, ModeLine
from app.models.source import Source
from app.models.test_record import TestRecord, TestRecordMode
from app.schemas.mode import (
    InterceptModePlan,
    InterceptModePlanResult,
    ModeLineFields,
    ModesFromIntercept,
    ModeCreate,
    ModeCreateFromDsl,
    ModeOut,
    ModeUpdate,
    NON_DSL_LINE_FIELDS,
    require_manual_deltas,
    validate_pri_type_fields,
)
from app.services.audit_service import apply_and_diff, record_audit, snapshot
from app.services.dsl_mode_service import create_mode_from_dsl
from app.services.frametime_service import FRAME_TIME_DECIMALS, compute_frametime_us
from app.services.mode_test_status_service import attach_mode_extras

router = APIRouter(prefix="/ew-groups/{ew_group_id}/modes", tags=["modes"])

# ModeLineFields columns that aren't part of the rendered DSL line text.
_NON_DSL_LINE_FIELDS = NON_DSL_LINE_FIELDS


def _get_ew_group_or_404(db: Session, ew_group_id: UUID) -> EwGroup:
    ew_group = db.get(EwGroup, ew_group_id)
    if ew_group is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "EW Group not found")
    return ew_group


def _check_function_group(db: Session, *, function_group_id: UUID | None, emitter_id: UUID) -> None:
    if function_group_id is None:
        return
    group = db.get(FunctionGroup, function_group_id)
    if group is None or group.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Function Group not found in this Emitter")


def _link_derived_test_records(db: Session, *, mode_id: UUID, test_record_ids: list[UUID]) -> None:
    if not test_record_ids:
        return
    found_ids = {r.id for r in db.query(TestRecord.id).filter(TestRecord.id.in_(test_record_ids)).all()}
    missing = set(test_record_ids) - found_ids
    if missing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown test record id(s): {missing}")
    for test_record_id in test_record_ids:
        db.add(TestRecordMode(test_record_id=test_record_id, mode_id=mode_id, link_type=TestRecordModeLinkType.derived))


def _link_derived_intercept_entries(db: Session, *, mode_id: UUID, intercept_entry_ids: list[UUID]) -> None:
    if not intercept_entry_ids:
        return
    found_ids = {
        e.id for e in db.query(InterceptEntry.id).filter(InterceptEntry.id.in_(intercept_entry_ids)).all()
    }
    missing = set(intercept_entry_ids) - found_ids
    if missing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown intercept entry id(s): {missing}")
    for intercept_entry_id in intercept_entry_ids:
        db.add(InterceptEntryMode(intercept_entry_id=intercept_entry_id, mode_id=mode_id))


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
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Source and EW Group must belong to the same Emitter",
        )
    _check_function_group(db, function_group_id=payload.function_group_id, emitter_id=ew_group.emitter_id)

    mode = Mode(
        ew_group_id=ew_group_id,
        source_id=payload.source_id,
        name=payload.name,
        pri_type=payload.pri_type,
        notes=payload.notes,
        sort_order=payload.sort_order,
        confirmation_quality=payload.confirmation_quality,
        confirmation_quantity=payload.confirmation_quantity,
        function_group_id=payload.function_group_id,
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
    _link_derived_intercept_entries(
        db, mode_id=mode.id, intercept_entry_ids=payload.derived_from_intercept_entry_ids
    )
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
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Source and EW Group must belong to the same Emitter",
        )
    _check_function_group(db, function_group_id=payload.function_group_id, emitter_id=ew_group.emitter_id)
    try:
        mode = create_mode_from_dsl(
            db,
            source=source,
            ew_group_id=ew_group_id,
            name=payload.name,
            dsl_text=payload.dsl_text,
            notes=payload.notes,
            sort_order=payload.sort_order,
            function_group_id=payload.function_group_id,
            confirmation_quality=payload.confirmation_quality,
            confirmation_quantity=payload.confirmation_quantity,
        )
    except DslSyntaxError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
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

    data = payload.model_dump(
        exclude_unset=True, exclude={"line", "derived_from_test_record_ids", "derived_from_intercept_entry_ids"}
    )
    if "ew_group_id" in data:
        new_ew_group = db.get(EwGroup, data["ew_group_id"])
        if new_ew_group is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Target EW Group not found")
        if new_ew_group.emitter_id != mode.source.emitter_id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "Target EW Group must belong to the same Emitter as the Mode's Source",
            )
    if "source_id" in data:
        new_source = db.get(Source, data["source_id"])
        if new_source is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Target Source not found")
        if new_source.emitter_id != mode.source.emitter_id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "Target Source must belong to the same Emitter as the Mode",
            )
    if "function_group_id" in data:
        _check_function_group(db, function_group_id=data["function_group_id"], emitter_id=mode.source.emitter_id)
    if "pri_type" in data and data["pri_type"] != mode.pri_type and payload.line is None:
        # The old type's PRI fields (e.g. Fixed's jitter) are meaningless
        # under the new one (e.g. Stagger's sequence) — there's no partial
        # edit that makes sense, so a type change must supply a full new
        # line in the same request.
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Changing pri_type requires a new line in the same request"
        )
    changes = apply_and_diff(mode, data)

    if payload.line is not None:
        # Unlike ModeCreate (where this same check runs inside a Pydantic
        # model_validator and FastAPI auto-converts its ValueError to a 422),
        # here it's a plain function call after parsing already succeeded —
        # an invalid line would otherwise propagate as an unhandled 500.
        try:
            validate_pri_type_fields(mode.pri_type, payload.line)
            require_manual_deltas(mode.pri_type, payload.line)
        except ValueError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc))
        line_fields = payload.line.model_dump()
        changes.update(apply_and_diff(mode.line, line_fields))
        try:
            mode.line.dsl_text = render_mode_line(
                pri_type=mode.pri_type, **{k: v for k, v in line_fields.items() if k not in _NON_DSL_LINE_FIELDS}
            )
        except DslSyntaxError:
            mode.line.dsl_text = None

    _link_derived_test_records(db, mode_id=mode.id, test_record_ids=payload.derived_from_test_record_ids)
    _link_derived_intercept_entries(
        db, mode_id=mode.id, intercept_entry_ids=payload.derived_from_intercept_entry_ids
    )

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
    mode_snapshot = snapshot(
        mode,
        [
            "name", "pri_type", "notes", "sort_order", "source_id", "function_group_id",
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
        summary=f"Deleted Mode '{mode.name}'",
        changes=mode_snapshot,
        emitter_id=mode.source.emitter_id,
    )
    db.delete(mode)
    db.commit()


def _f(v) -> float | None:
    return None if v is None else float(v)


def _line_from_entry(entry: InterceptEntry, payload: ModesFromIntercept) -> dict:
    """A Mode line from an Intercept entry: its measured range (or its mean),
    with the deltas given. Fixed takes the entry's jitter as both ends of the
    jitter range, like a single Mode created from an entry."""
    measured = payload.ranges == "measured"

    def span(lo, hi, mean):
        m = _f(mean)
        return (_f(lo) if measured and lo is not None else m, _f(hi) if measured and hi is not None else m)

    rf_min, rf_max = span(entry.rf_min_mhz, entry.rf_max_mhz, entry.rf_mean_mhz)
    line = dict(
        rf_min_mhz=rf_min,
        rf_max_mhz=rf_max,
        rf_delta=payload.rf_delta,
        pw_delta=payload.pw_delta,
        rf_range_matching=False,
        pw_range_matching=False,
        pri_range_matching=False,
    )
    if entry.pri_type == PriType.cw:
        line.update(pw_min_us=payload.cw_pw_min_us, pw_max_us=payload.cw_pw_max_us)
        return line
    pw_min, pw_max = span(entry.pw_min_us, entry.pw_max_us, entry.pw_mean_us)
    line.update(pw_min_us=pw_min, pw_max_us=pw_max)
    if entry.pri_type == PriType.fixed:
        pri_min, pri_max = span(entry.pri_min_us, entry.pri_max_us, entry.pri_mean_us)
        jitter = _f(entry.jitter_mean_us) or 0.0
        line.update(pri_min_us=pri_min, pri_max_us=pri_max, pri_delta=payload.pri_delta, jitter_min_us=jitter, jitter_max_us=jitter)
    else:
        values = [float(v) for v in entry.stagger_values or []]
        # The file's own frame time where it differs from the sum of the positions.
        frame = _f(entry.pri_mean_us)
        if frame is not None and values and abs(frame - compute_frametime_us(values)) > 10 ** -FRAME_TIME_DECIMALS:
            line["explicit_frame_time_us"] = round(frame, FRAME_TIME_DECIMALS)
        # A Mode's frame time is one value with a ± delta, so the measured spread
        # goes into the delta: far enough either side to reach the lowest and
        # highest frame time measured.
        centre = frame if frame is not None else (compute_frametime_us(values) if values else None)
        spread = 0.0
        if measured and centre is not None:
            for edge in (_f(entry.pri_min_us), _f(entry.pri_max_us)):
                if edge is not None:
                    spread = max(spread, abs(edge - centre))
        line.update(
            pri_stagger_values_us=values,
            frame_time_delta_us=round(payload.frame_time_delta_us + spread, FRAME_TIME_DECIMALS),
        )
    return line


@router.post(
    "/from-intercept",
    response_model=list[ModeOut],
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def create_modes_from_intercept(
    ew_group_id: UUID,
    payload: ModesFromIntercept,
    db: Session = Depends(get_db),
    user=Depends(require_ew_group_checkout()),
) -> list[ModeOut]:
    """One Mode per Intercept entry, all or nothing, in one generation batch
    (deletable together from the Modes tab). Each Mode is linked to the entry
    it came from, like a single Mode created from an entry."""
    ew_group = _get_ew_group_or_404(db, ew_group_id)
    intercept = db.get(Intercept, payload.intercept_id)
    if intercept is None or intercept.emitter_id != ew_group.emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Intercept not found on this Emitter")
    source = db.get(Source, payload.source_id)
    if source is None or source.emitter_id != ew_group.emitter_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Source and EW Group must belong to the same Emitter")
    _check_function_group(db, function_group_id=payload.function_group_id, emitter_id=ew_group.emitter_id)
    wanted = set(payload.entry_ids)
    entries = (
        db.query(InterceptEntry)
        .filter(InterceptEntry.intercept_id == intercept.id, InterceptEntry.id.in_(wanted))
        .order_by(InterceptEntry.pri_type, InterceptEntry.rf_mean_mhz, InterceptEntry.id)
        .all()
    )
    if len(entries) != len(wanted):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Some of those entries aren't on this Intercept")
    if any(e.pri_type == PriType.cw for e in entries) and (
        payload.cw_pw_min_us is None or payload.cw_pw_max_us is None
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "A CW entry has no PW, but a CW Mode needs a PW range — give cw_pw_min_us and cw_pw_max_us",
        )

    # Every line is checked before anything is written.
    lines = []
    for entry in entries:
        try:
            fields = ModeLineFields(**_line_from_entry(entry, payload))
            validate_pri_type_fields(entry.pri_type, fields)
        except ValueError as err:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"The entry at RF {float(entry.rf_mean_mhz)} MHz can't become a Mode: {err}",
            )
        lines.append(fields.model_dump())

    batch = ModeGenerationBatch(
        ew_group_id=ew_group_id, source_id=source.id, name_prefix=payload.name_prefix, created_by=user.id
    )
    db.add(batch)
    db.flush()
    used = {name for (name,) in db.query(Mode.name).filter(Mode.ew_group_id == ew_group_id).all()}
    base_sort = db.query(func.max(Mode.sort_order)).filter(Mode.ew_group_id == ew_group_id).scalar() or 0
    counter = 1
    created: list[Mode] = []
    for entry, line_fields in zip(entries, lines):
        while f"{payload.name_prefix} {counter}" in used:
            counter += 1
        name = f"{payload.name_prefix} {counter}"
        used.add(name)
        counter += 1
        mode = Mode(
            ew_group_id=ew_group_id,
            source_id=source.id,
            name=name,
            pri_type=entry.pri_type,
            notes=f"From Intercept '{intercept.name}'"
            + (f", an entry of {entry.report_count} reports" if entry.report_count else ""),
            sort_order=base_sort + len(created) + 1,
            confirmation_quality=payload.confirmation_quality,
            confirmation_quantity=payload.confirmation_quantity,
            function_group_id=payload.function_group_id,
            generation_batch_id=batch.id,
        )
        db.add(mode)
        db.flush()
        try:
            dsl_text = render_mode_line(
                pri_type=entry.pri_type, **{k: v for k, v in line_fields.items() if k not in _NON_DSL_LINE_FIELDS}
            )
        except DslSyntaxError:
            dsl_text = None
        db.add(ModeLine(mode_id=mode.id, dsl_text=dsl_text, **line_fields))
        db.add(InterceptEntryMode(intercept_entry_id=entry.id, mode_id=mode.id))
        record_audit(
            db,
            actor_id=user.id,
            action=AuditAction.create,
            entity_type=AuditEntityType.mode.value,
            entity_id=mode.id,
            summary=f"Created Mode '{mode.name}' from Intercept '{intercept.name}' (batch '{payload.name_prefix}')",
            changes={**{k: (v if not isinstance(v, list) else list(v)) for k, v in line_fields.items()},
                     "generation_batch_id": str(batch.id), "intercept_entry_id": str(entry.id)},
            emitter_id=ew_group.emitter_id,
        )
        created.append(mode)
    db.commit()
    for mode in created:
        db.refresh(mode)
    return attach_mode_extras(db, created)


# What a widening may change, and the parameter each belongs to (for the audit summary).
_WIDEN_FIELDS = {
    "rf_min_mhz": "RF",
    "rf_max_mhz": "RF",
    "pri_min_us": "PRI",
    "pri_max_us": "PRI",
    "pw_min_us": "PW",
    "pw_max_us": "PW",
    "frame_time_delta_us": "Frame time",
}


def _link_entries_once(db: Session, mode_id: UUID, entry_ids: list[UUID]) -> None:
    """Links entries to a Mode, skipping any already linked to it."""
    have = {
        eid
        for (eid,) in db.query(InterceptEntryMode.intercept_entry_id)
        .filter(InterceptEntryMode.mode_id == mode_id, InterceptEntryMode.intercept_entry_id.in_(entry_ids))
        .all()
    }
    for entry_id in entry_ids:
        if entry_id not in have:
            db.add(InterceptEntryMode(intercept_entry_id=entry_id, mode_id=mode_id))
            have.add(entry_id)


@router.post(
    "/from-intercept-plan",
    response_model=InterceptModePlanResult,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def apply_intercept_mode_plan(
    ew_group_id: UUID,
    payload: InterceptModePlan,
    db: Session = Depends(get_db),
    user=Depends(require_ew_group_checkout()),
) -> InterceptModePlanResult:
    """Applies a plan made on an Intercept's planning page, all or nothing:
    new Modes go into this EW Group as one generation batch; widened Modes
    (any EW Group of the same Emitter) only have ranges grown. Every Mode is
    linked to the entries it was made or widened for."""
    ew_group = _get_ew_group_or_404(db, ew_group_id)
    emitter_id = ew_group.emitter_id
    intercept = db.get(Intercept, payload.intercept_id)
    if intercept is None or intercept.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Intercept not found on this Emitter")

    wanted = {eid for item in [*payload.new_modes, *payload.widen] for eid in item.entry_ids}
    entries = {
        e.id: e
        for e in db.query(InterceptEntry)
        .filter(InterceptEntry.intercept_id == intercept.id, InterceptEntry.id.in_(wanted))
        .all()
    }
    if len(entries) != len(wanted):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Some of those entries aren't on this Intercept")

    source = None
    if payload.new_modes:
        source = db.get(Source, payload.source_id)
        if source is None or source.emitter_id != emitter_id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "Source and EW Group must belong to the same Emitter"
            )
        _check_function_group(db, function_group_id=payload.function_group_id, emitter_id=emitter_id)

    # Check everything before writing anything.
    for i, planned in enumerate(payload.new_modes):
        if any(entries[eid].pri_type != planned.pri_type for eid in planned.entry_ids):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, f"New Mode {i + 1}: its entries must all be {planned.pri_type.value}"
            )
        try:
            validate_pri_type_fields(planned.pri_type, planned.line)
            require_manual_deltas(planned.pri_type, planned.line)
        except ValueError as err:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"New Mode {i + 1}: {err}")

    widen_plan: list[tuple[Mode, dict, list[UUID]]] = []
    for w in payload.widen:
        mode = db.get(Mode, w.mode_id)
        if mode is None or mode.line is None or db.get(EwGroup, mode.ew_group_id).emitter_id != emitter_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "A Mode to widen isn't on this Emitter")
        if any(entries[eid].pri_type != mode.pri_type for eid in w.entry_ids):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, f"Mode '{mode.name}' is {mode.pri_type.value}; its entries must be too"
            )
        line = mode.line
        changes: dict = {}
        for field in _WIDEN_FIELDS:
            new = getattr(w, field)
            if new is None:
                continue
            old = _f(getattr(line, field))
            upper = field.endswith(("_max_mhz", "_max_us")) or field == "frame_time_delta_us"
            grows = old is None or (new >= old - 1e-9 if upper else new <= old + 1e-9)
            if not grows:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    f"Widening only grows a range — {field} of Mode '{mode.name}' would go from {old} to {new}",
                )
            if old is None or abs(new - old) > 1e-9:
                changes[field] = new
        if mode.pri_type == PriType.stagger and any(k.startswith("pri_") for k in changes):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "A stagger Mode is widened on its frame-time delta, not PRI"
            )
        if mode.pri_type == PriType.fixed and "frame_time_delta_us" in changes:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A fixed Mode has no frame time to widen")
        current = {k: getattr(line, k) for k in ModeLineFields.model_fields}
        try:
            fields = ModeLineFields(**{**current, **changes})
            validate_pri_type_fields(mode.pri_type, fields)
        except ValueError as err:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Mode '{mode.name}': {err}")
        widen_plan.append((mode, changes, w.entry_ids))

    created: list[Mode] = []
    if payload.new_modes:
        prefix = payload.name_prefix.strip()
        batch = ModeGenerationBatch(ew_group_id=ew_group_id, source_id=source.id, name_prefix=prefix, created_by=user.id)
        db.add(batch)
        db.flush()
        used = {name for (name,) in db.query(Mode.name).filter(Mode.ew_group_id == ew_group_id).all()}
        base_sort = db.query(func.max(Mode.sort_order)).filter(Mode.ew_group_id == ew_group_id).scalar() or 0
        counter = 1
        for planned in payload.new_modes:
            while f"{prefix} {counter}" in used:
                counter += 1
            name = f"{prefix} {counter}"
            used.add(name)
            counter += 1
            reports = sum(entries[eid].report_count or 0 for eid in planned.entry_ids)
            mode = Mode(
                ew_group_id=ew_group_id,
                source_id=source.id,
                name=name,
                pri_type=planned.pri_type,
                notes=f"From Intercept '{intercept.name}'" + (f", {reports} reports" if reports else ""),
                sort_order=base_sort + len(created) + 1,
                confirmation_quality=payload.confirmation_quality,
                confirmation_quantity=payload.confirmation_quantity,
                function_group_id=payload.function_group_id,
                generation_batch_id=batch.id,
            )
            db.add(mode)
            db.flush()
            line_fields = planned.line.model_dump()
            try:
                dsl_text = render_mode_line(
                    pri_type=planned.pri_type,
                    **{k: v for k, v in line_fields.items() if k not in _NON_DSL_LINE_FIELDS},
                )
            except DslSyntaxError:
                dsl_text = None
            db.add(ModeLine(mode_id=mode.id, dsl_text=dsl_text, **line_fields))
            _link_entries_once(db, mode.id, planned.entry_ids)
            record_audit(
                db,
                actor_id=user.id,
                action=AuditAction.create,
                entity_type=AuditEntityType.mode.value,
                entity_id=mode.id,
                summary=f"Created Mode '{mode.name}' from Intercept '{intercept.name}' (batch '{prefix}')",
                changes={
                    **{k: (list(v) if isinstance(v, list) else v) for k, v in line_fields.items()},
                    "generation_batch_id": str(batch.id),
                    "intercept_entry_ids": [str(e) for e in planned.entry_ids],
                },
                emitter_id=emitter_id,
            )
            created.append(mode)

    widened: list[Mode] = []
    for mode, changes, entry_ids in widen_plan:
        diff = apply_and_diff(mode.line, changes) if changes else {}
        if diff:
            line_fields = {k: getattr(mode.line, k) for k in ModeLineFields.model_fields}
            try:
                mode.line.dsl_text = render_mode_line(
                    pri_type=mode.pri_type,
                    **{k: v for k, v in line_fields.items() if k not in _NON_DSL_LINE_FIELDS},
                )
            except DslSyntaxError:
                mode.line.dsl_text = None
        _link_entries_once(db, mode.id, entry_ids)
        params = sorted({_WIDEN_FIELDS[k] for k in diff})
        record_audit(
            db,
            actor_id=user.id,
            action=AuditAction.update,
            entity_type=AuditEntityType.mode.value,
            entity_id=mode.id,
            summary=(
                f"Widened Mode '{mode.name}' ({', '.join(params)}) to cover Intercept '{intercept.name}'"
                if params
                else f"Linked Mode '{mode.name}' to Intercept '{intercept.name}' (it already covered it)"
            ),
            changes={**diff, "intercept_entry_ids": [str(e) for e in entry_ids]},
            emitter_id=emitter_id,
        )
        widened.append(mode)

    db.commit()
    for mode in [*created, *widened]:
        db.refresh(mode)
    return InterceptModePlanResult(created=attach_mode_extras(db, created), widened=attach_mode_extras(db, widened))
