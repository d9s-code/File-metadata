from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.enums import AuditAction, AuditEntityType, ElementType, PriType
from app.dsl.renderer import render_mode_line
from app.models.mode import Mode, ModeElement, ModeGenerationBatch, ModeLine
from app.models.parameter_sequence import ParameterSequence
from app.models.source import Source
from app.schemas.mode_element import SequenceStepSelection
from app.services.audit_service import _json_safe, record_audit

# ModeLine columns that aren't part of the rendered DSL line text — mirrors
# _NON_DSL_LINE_FIELDS in routers/modes.py (render_mode_line has a strict,
# keyword-only signature with no catch-all, so these must never reach it).
_NON_DSL_LINE_FIELDS = {
    "rf_delta",
    "pw_delta",
    "pri_delta",
    "frame_time_delta_us",
    "explicit_frame_time_us",
    "rf_range_matching",
    "pw_range_matching",
    "pri_range_matching",
}


class CartesianProductError(ValueError):
    pass



def _step_range(step: dict, point: str, lo: str, hi: str) -> tuple[float, float] | None:
    """A sequence step's (min, max) for one parameter: its stored range, or
    its single value as min == max; None when the step doesn't set it."""
    if step.get(lo) is not None and step.get(hi) is not None:
        return float(step[lo]), float(step[hi])
    if step.get(point) is not None:
        return float(step[point]), float(step[point])
    return None

def _fetch_elements(db: Session, source_id: UUID, ids: list[UUID], expected_type: ElementType) -> list[ModeElement]:
    if not ids:
        raise CartesianProductError(f"At least one {expected_type.value} element must be chosen")
    elements = db.query(ModeElement).filter(ModeElement.id.in_(ids)).all()
    found_ids = {e.id for e in elements}
    missing = set(ids) - found_ids
    if missing:
        raise CartesianProductError(f"Unknown element id(s): {missing}")
    for e in elements:
        if e.source_id != source_id:
            raise CartesianProductError(f"Element {e.id} does not belong to this Source")
        if e.element_type != expected_type:
            raise CartesianProductError(f"Element {e.id} is not a {expected_type.value} element")
    return elements


def _dsl_kwargs(line_kwargs: dict) -> dict:
    return {k: v for k, v in line_kwargs.items() if k not in _NON_DSL_LINE_FIELDS}


def _fetch_selected_steps(
    db: Session, source_id: UUID, sequence_steps: list[SequenceStepSelection]
) -> list[tuple[ParameterSequence, dict, SequenceStepSelection]]:
    """Resolves (sequence_id, order) selections into their real (sequence,
    step) pairs, in the order given, alongside the original selection (which
    may carry a per-step delta override for this run). Raises if a sequence
    id is unknown, doesn't belong to this Source, or doesn't have a step at
    that order."""
    sequence_ids = {s.sequence_id for s in sequence_steps}
    sequences = db.query(ParameterSequence).filter(ParameterSequence.id.in_(sequence_ids)).all()
    by_id = {s.id: s for s in sequences}
    missing = sequence_ids - set(by_id)
    if missing:
        raise CartesianProductError(f"Unknown sequence id(s): {missing}")
    for seq in sequences:
        if seq.source_id != source_id:
            raise CartesianProductError(f"Sequence {seq.id} does not belong to this Source")

    resolved: list[tuple[ParameterSequence, dict, SequenceStepSelection]] = []
    for selection in sequence_steps:
        seq = by_id[selection.sequence_id]
        step = next((s for s in seq.steps if s.get("order") == selection.order), None)
        if step is None:
            raise CartesianProductError(f"Sequence {selection.sequence_id} has no step at order {selection.order}")
        resolved.append((seq, step, selection))
    return resolved


def run_cartesian_product(
    db: Session,
    *,
    source: Source,
    ew_group_id: UUID,
    rf_element_ids: list[UUID],
    pw_element_ids: list[UUID],
    pri_element_ids: list[UUID],
    sequence_steps: list[SequenceStepSelection] | None = None,
    name_prefix: str,
    created_by: UUID | None = None,
    batch_note: str | None = None,
    rf_delta_overrides: dict[UUID, float] | None = None,
    pw_delta_overrides: dict[UUID, float] | None = None,
    pri_delta_overrides: dict[UUID, float] | None = None,
    rf_range_matching: bool = False,
    pw_range_matching: bool = False,
    pri_range_matching: bool = False,
) -> list[Mode]:
    rf_delta_overrides = rf_delta_overrides or {}
    pw_delta_overrides = pw_delta_overrides or {}
    pri_delta_overrides = pri_delta_overrides or {}

    # Fetch elements conditionally to avoid errors when sequence steps are used
    rf_elements = _fetch_elements(db, source.id, rf_element_ids, ElementType.rf) if rf_element_ids else [None]
    pw_elements = _fetch_elements(db, source.id, pw_element_ids, ElementType.pw) if pw_element_ids else [None]

    selected_steps = _fetch_selected_steps(db, source.id, sequence_steps) if sequence_steps else []

    # The "PRI axis" of the cartesian run: either real fetched PRI Elements
    # (no steps selected — the original, element-only path), or the caller's
    # individually-chosen (sequence, step) pairs. Exactly one axis is active
    # per run — selecting steps disables PRI Element selection, same as the
    # old whole-sequence behavior did.
    if selected_steps:
        pri_axis: list[
            tuple[ModeElement | None, ParameterSequence | None, dict | None, SequenceStepSelection | None]
        ] = [(None, seq, step, selection) for seq, step, selection in selected_steps]
    else:
        pri_elements = _fetch_elements(db, source.id, pri_element_ids, ElementType.pri)
        is_stagger = [bool(e.stagger_values) for e in pri_elements]
        if any(is_stagger) and not all(is_stagger):
            raise CartesianProductError(
                "PRI elements chosen for one cartesian-product run must be all Fixed-style ranges "
                "or all Stagger sequences, not a mix"
            )
        pri_axis = [(pri_el, None, None, None) for pri_el in pri_elements]

    batch = ModeGenerationBatch(
        ew_group_id=ew_group_id, source_id=source.id, name_prefix=name_prefix, created_by=created_by
    )
    db.add(batch)
    db.flush()

    base_sort_order = db.query(func.max(Mode.sort_order)).filter(Mode.ew_group_id == ew_group_id).scalar() or 0

    # Auto-suffix on collision: a re-run with the same name_prefix must not
    # produce Modes with names identical to an earlier run's. Seed with every
    # existing name in this EW Group (not just this prefix — cheap, and
    # avoids ever colliding with an unrelated Mode too), then keep bumping
    # the counter past any name already taken as new ones are minted below.
    used_names = {
        name for (name,) in db.query(Mode.name).filter(Mode.ew_group_id == ew_group_id).all()
    }
    counter = 1

    def _next_name() -> str:
        nonlocal counter
        while f"{name_prefix} {counter}" in used_names:
            counter += 1
        name = f"{name_prefix} {counter}"
        used_names.add(name)
        counter += 1
        return name

    created: list[Mode] = []

    def _create_mode(pri_type: PriType, line_kwargs: dict) -> Mode:
        name = _next_name()
        mode = Mode(
            ew_group_id=ew_group_id,
            source_id=source.id,
            name=name,
            pri_type=pri_type,
            sort_order=base_sort_order + len(created) + 1,
            generation_batch_id=batch.id,
            notes=batch_note,
        )
        db.add(mode)
        db.flush()

        dsl_text = render_mode_line(pri_type=pri_type, **_dsl_kwargs(line_kwargs))
        db.add(ModeLine(mode_id=mode.id, dsl_text=dsl_text, **line_kwargs))

        record_audit(
            db,
            actor_id=created_by,
            action=AuditAction.create,
            entity_type=AuditEntityType.mode.value,
            entity_id=mode.id,
            summary=f"Created Mode '{mode.name}' via cartesian product batch '{name_prefix}'",
            changes={**{k: _json_safe(v) for k, v in line_kwargs.items()}, "generation_batch_id": str(batch.id)},
            emitter_id=source.emitter_id,
        )
        created.append(mode)
        return mode

    for pri_el, seq, step, selection in pri_axis:
        pri_type = PriType.stagger if (pri_el and pri_el.stagger_values) else PriType.fixed

        for rf_el in rf_elements:
            for pw_el in pw_elements:
                rf_delta = rf_delta_overrides.get(rf_el.id, rf_el.delta) if rf_el else None
                pw_delta = pw_delta_overrides.get(pw_el.id, pw_el.delta) if pw_el else None

                # Store the element's own RAW value + the resolved delta
                # separately (not pre-widened into one number) — same
                # raw-vs-engineered split a manually-authored line keeps,
                # so ModeLineOut's engineered_* fields do the widening on
                # read instead of it being baked in and then unrecoverable.
                base_line_kwargs = dict(
                    rf_min_mhz=rf_el.value_min if rf_el else 0.0,
                    rf_max_mhz=rf_el.value_max if rf_el else 0.0,
                    rf_delta=rf_delta,
                    rf_range_matching=rf_range_matching,
                    pw_min_us=pw_el.value_min if pw_el else 0.0,
                    pw_max_us=pw_el.value_max if pw_el else 0.0,
                    pw_delta=pw_delta,
                    pw_range_matching=pw_range_matching,
                    pri_range_matching=pri_range_matching,
                )

                if pri_el:
                    pri_delta = pri_delta_overrides.get(pri_el.id, pri_el.delta)
                    if pri_type == PriType.stagger:
                        base_line_kwargs["pri_stagger_values_us"] = pri_el.stagger_values
                        base_line_kwargs["frame_time_delta_us"] = pri_delta
                    else:
                        base_line_kwargs.update(
                            pri_min_us=pri_el.value_min,
                            pri_max_us=pri_el.value_max,
                            pri_delta=pri_delta,
                            jitter_min_us=pri_el.jitter_min if pri_el.jitter_min is not None else 0.0,
                            jitter_max_us=pri_el.jitter_max if pri_el.jitter_max is not None else 1.0,
                        )

                if step is not None:
                    # A single selected step always becomes exactly one
                    # Fixed-PRI Mode — the step's PRI range, or a point value
                    # (min == max) if it sets pri_us, degenerate 0.0/0.0
                    # otherwise (matching the element-less-PRI fallback this
                    # already had). RF and PW work the same way.
                    step_line_kwargs = base_line_kwargs.copy()
                    step_pri = _step_range(step, "pri_us", "pri_min_us", "pri_max_us")
                    step_jitter_min = step.get("jitter_min_us")
                    step_jitter_max = step.get("jitter_max_us")

                    # A per-step override (this run only) takes precedence
                    # over the sequence's own stored delta, which stays the
                    # default when no override is given.
                    step_rf_delta = selection.rf_delta if selection.rf_delta is not None else seq.rf_delta
                    step_pw_delta = selection.pw_delta if selection.pw_delta is not None else seq.pw_delta
                    step_pri_delta = selection.pri_delta if selection.pri_delta is not None else seq.pri_delta

                    if step_pri is not None:
                        step_line_kwargs["pri_min_us"], step_line_kwargs["pri_max_us"] = step_pri
                        if step_pri_delta is not None:
                            step_line_kwargs["pri_delta"] = step_pri_delta
                    else:
                        step_line_kwargs["pri_min_us"] = 0.0
                        step_line_kwargs["pri_max_us"] = 0.0

                    step_line_kwargs["jitter_min_us"] = float(step_jitter_min) if step_jitter_min is not None else 0.0
                    step_line_kwargs["jitter_max_us"] = float(step_jitter_max) if step_jitter_max is not None else 1.0

                    step_rf = _step_range(step, "rf_mhz", "rf_min_mhz", "rf_max_mhz")
                    if step_rf is not None:
                        step_line_kwargs["rf_min_mhz"], step_line_kwargs["rf_max_mhz"] = step_rf
                        if step_rf_delta is not None:
                            step_line_kwargs["rf_delta"] = step_rf_delta

                    step_pw = _step_range(step, "pw_us", "pw_min_us", "pw_max_us")
                    if step_pw is not None:
                        step_line_kwargs["pw_min_us"], step_line_kwargs["pw_max_us"] = step_pw
                        if step_pw_delta is not None:
                            step_line_kwargs["pw_delta"] = step_pw_delta

                    _create_mode(PriType.fixed, step_line_kwargs)
                else:
                    if pri_type == PriType.stagger:
                        base_line_kwargs["frame_time_delta_us"] = pri_delta_overrides.get(pri_el.id, pri_el.delta)
                    _create_mode(pri_type, base_line_kwargs)

    db.commit()
    for mode in created:
        db.refresh(mode)
    return created
