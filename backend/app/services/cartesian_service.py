from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.enums import AuditAction, AuditEntityType, ElementType, PriType
from app.dsl.renderer import render_mode_line
from app.models.mode import Mode, ModeElement, ModeGenerationBatch, ModeLine
from app.models.parameter_sequence import ParameterSequence
from app.models.source import Source
from app.services.audit_service import _json_safe, record_audit

# ModeLine columns that aren't part of the rendered DSL line text — mirrors
# _NON_DSL_LINE_FIELDS in routers/modes.py (render_mode_line has a strict,
# keyword-only signature with no catch-all, so these must never reach it).
_NON_DSL_LINE_FIELDS = {
    "rf_delta",
    "pw_delta",
    "pri_delta",
    "frame_time_delta_us",
    "rf_range_matching",
    "pw_range_matching",
    "pri_range_matching",
}


class CartesianProductError(ValueError):
    pass


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


def run_cartesian_product(
    db: Session,
    *,
    source: Source,
    ew_group_id: UUID,
    rf_element_ids: list[UUID],
    pw_element_ids: list[UUID],
    pri_element_ids: list[UUID],
    sequence_ids: list[UUID] | None = None,
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

    # Fetch elements conditionally to avoid errors when sequences are used
    rf_elements = _fetch_elements(db, source.id, rf_element_ids, ElementType.rf) if rf_element_ids else [None]
    pw_elements = _fetch_elements(db, source.id, pw_element_ids, ElementType.pw) if pw_element_ids else [None]

    sequences: list[ParameterSequence] = []
    if sequence_ids:
        sequences = db.query(ParameterSequence).filter(
            ParameterSequence.id.in_(sequence_ids),
            ParameterSequence.source_id == source.id
        ).order_by(ParameterSequence.sort_order).all()

    if sequences:
        pri_elements = [None]
    else:
        pri_elements = _fetch_elements(db, source.id, pri_element_ids, ElementType.pri)

    is_stagger = [bool(e.stagger_values) for e in pri_elements if e]
    if any(is_stagger) and not all(is_stagger):
        raise CartesianProductError(
            "PRI elements chosen for one cartesian-product run must be all Fixed-style ranges "
            "or all Stagger sequences, not a mix"
        )

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

    def _next_name(counter: int) -> tuple[str, int]:
        while f"{name_prefix} {counter}" in used_names:
            counter += 1
        name = f"{name_prefix} {counter}"
        used_names.add(name)
        return name, counter + 1

    created: list[Mode] = []
    counter = 1

    seq_iter = sequences if sequences else [None]
    pri_iter = pri_elements if not sequences else [None]

    for seq in seq_iter:
        for pri_el in pri_iter:
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

                    if seq:
                        # A sequence is PRI-only if no step modifies RF or PW.
                        is_pri_sequence = all(step.get("rf_mhz") is None and step.get("pw_us") is None for step in seq.steps)

                        if is_pri_sequence:
                            # CASE 1: PRI-only sequence -> ONE Mode, ONE ModeLine (containing the whole sequence)
                            # We treat all PRI-only sequences as Staggered modes to group the steps into one array.
                            mode_pri_type = PriType.stagger
                            name, counter = _next_name(counter)

                            mode = Mode(
                                ew_group_id=ew_group_id,
                                source_id=source.id,
                                name=name,
                                pri_type=mode_pri_type,
                                sort_order=base_sort_order + counter,
                                generation_batch_id=batch.id,
                                notes=batch_note,
                            )
                            db.add(mode)
                            db.flush()

                            step_line_kwargs = base_line_kwargs.copy()

                            # Extract all PRI values from the sequence into a single array for the ModeLine
                            stagger_vals = []
                            for step in seq.steps:
                                if "pri_stagger_values_us" in step:
                                    stagger_vals.extend(step["pri_stagger_values_us"])
                                elif "pri_us" in step:
                                    stagger_vals.append(float(step["pri_us"]))

                            if stagger_vals:
                                step_line_kwargs["pri_stagger_values_us"] = stagger_vals

                            # For Stagger modes, frame_time_delta_us should be provided if available in steps
                            if seq.steps:
                                if "frame_time_delta_us" in seq.steps[0]:
                                    step_line_kwargs["frame_time_delta_us"] = float(seq.steps[0]["frame_time_delta_us"])

                            step_dsl = render_mode_line(pri_type=mode_pri_type, **_dsl_kwargs(step_line_kwargs))
                            db.add(ModeLine(mode_id=mode.id, dsl_text=step_dsl, **step_line_kwargs))

                            record_audit(
                                db,
                                actor_id=created_by,
                                action=AuditAction.create,
                                entity_type=AuditEntityType.mode.value,
                                entity_id=mode.id,
                                summary=f"Created Mode '{mode.name}' via cartesian product batch '{name_prefix}'",
                                changes={**{k: _json_safe(v) for k, v in step_line_kwargs.items()}, "generation_batch_id": str(batch.id)},
                                emitter_id=source.emitter_id,
                            )
                            created.append(mode)
                        else:
                            # CASE 2: RF/PW sequence -> ONE Mode PER step
                            for step in seq.steps:
                                step_line_kwargs = base_line_kwargs.copy()

                                step_pri_us = step.get("pri_us")
                                step_jitter_min = step.get("jitter_min_us")
                                step_jitter_max = step.get("jitter_max_us")

                                if step_pri_us is not None:
                                    step_line_kwargs["pri_min_us"] = float(step_pri_us)
                                    step_line_kwargs["pri_max_us"] = float(step_pri_us)
                                elif "pri_min_us" in base_line_kwargs:
                                    step_line_kwargs["pri_min_us"] = float(base_line_kwargs["pri_min_us"])
                                    step_line_kwargs["pri_max_us"] = float(base_line_kwargs["pri_max_us"])
                                else:
                                    step_line_kwargs["pri_min_us"] = 0.0
                                    step_line_kwargs["pri_max_us"] = 0.0

                                if step_jitter_min is not None:
                                    step_line_kwargs["jitter_min_us"] = float(step_jitter_min)
                                elif "jitter_min_us" in base_line_kwargs:
                                    step_line_kwargs["jitter_min_us"] = float(base_line_kwargs["jitter_min_us"])
                                else:
                                    step_line_kwargs["jitter_min_us"] = 0.0

                                if step_jitter_max is not None:
                                    step_line_kwargs["jitter_max_us"] = float(step_jitter_max)
                                elif "jitter_max_us" in base_line_kwargs:
                                    step_line_kwargs["jitter_max_us"] = float(base_line_kwargs["jitter_max_us"])
                                else:
                                    step_line_kwargs["jitter_max_us"] = 1.0

                                if step.get("rf_mhz") is not None:
                                    step_line_kwargs["rf_min_mhz"] = float(step["rf_mhz"])
                                    step_line_kwargs["rf_max_mhz"] = float(step["rf_mhz"])
                                elif "rf_min_mhz" in base_line_kwargs:
                                    step_line_kwargs["rf_min_mhz"] = float(base_line_kwargs["rf_min_mhz"])
                                    step_line_kwargs["rf_max_mhz"] = float(base_line_kwargs["rf_max_mhz"])

                                if step.get("pw_us") is not None:
                                    step_line_kwargs["pw_min_us"] = float(step["pw_us"])
                                    step_line_kwargs["pw_max_us"] = float(step["pw_us"])
                                elif "pw_min_us" in base_line_kwargs:
                                    step_line_kwargs["pw_min_us"] = float(base_line_kwargs["pw_min_us"])
                                    step_line_kwargs["pw_max_us"] = float(base_line_kwargs["pw_max_us"])

                                if "frame_time_delta_us" in step:
                                    step_line_kwargs["frame_time_delta_us"] = float(step["frame_time_delta_us"])

                                name, counter = _next_name(counter)
                                mode = Mode(
                                    ew_group_id=ew_group_id,
                                    source_id=source.id,
                                    name=name,
                                    pri_type=pri_type,
                                    sort_order=base_sort_order + counter,
                                    generation_batch_id=batch.id,
                                    notes=batch_note,
                                )
                                db.add(mode)
                                db.flush()

                                step_dsl = render_mode_line(pri_type=pri_type, **_dsl_kwargs(step_line_kwargs))
                                db.add(ModeLine(mode_id=mode.id, dsl_text=step_dsl, **step_line_kwargs))

                                record_audit(
                                    db,
                                    actor_id=created_by,
                                    action=AuditAction.create,
                                    entity_type=AuditEntityType.mode.value,
                                    entity_id=mode.id,
                                    summary=f"Created Mode '{mode.name}' via cartesian product batch '{name_prefix}'",
                                    changes={**{k: _json_safe(v) for k, v in step_line_kwargs.items()}, "generation_batch_id": str(batch.id)},
                                    emitter_id=source.emitter_id,
                                )
                                created.append(mode)
                    else:
                        # CASE 3: No sequence -> ONE Mode, ONE ModeLine
                        if pri_type == PriType.stagger:
                            base_line_kwargs["frame_time_delta_us"] = pri_delta_overrides.get(pri_el.id, pri_el.delta)

                        name, counter = _next_name(counter)
                        mode = Mode(
                            ew_group_id=ew_group_id,
                            source_id=source.id,
                            name=name,
                            pri_type=pri_type,
                            sort_order=base_sort_order + counter,
                            generation_batch_id=batch.id,
                            notes=batch_note,
                        )
                        db.add(mode)
                        db.flush()

                        dsl_text = render_mode_line(pri_type=pri_type, **_dsl_kwargs(base_line_kwargs))
                        db.add(ModeLine(mode_id=mode.id, dsl_text=dsl_text, **base_line_kwargs))

                        record_audit(
                            db,
                            actor_id=created_by,
                            action=AuditAction.create,
                            entity_type=AuditEntityType.mode.value,
                            entity_id=mode.id,
                            summary=f"Created Mode '{mode.name}' via cartesian product batch '{name_prefix}'",
                            changes={**{k: _json_safe(v) for k, v in base_line_kwargs.items()}, "generation_batch_id": str(batch.id)},
                            emitter_id=source.emitter_id,
                        )
                        created.append(mode)

    db.commit()
    for mode in created:
        db.refresh(mode)
    return created
