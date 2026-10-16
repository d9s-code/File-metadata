from collections.abc import Callable
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
from app.services.mode_sources import set_mode_sources

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

def _pri_label(e: ModeElement) -> str:
    if e.label:
        return e.label
    if e.stagger_values:
        return "stagger [" + ", ".join(f"{float(v):g}" for v in e.stagger_values) + "]"
    return f"{float(e.value_min):g}–{float(e.value_max):g} µs"


def _stagger_values_of(e: ModeElement) -> list[float]:
    """What one PRI Element puts in a stagger train: a stored stagger's own
    values, else its value — the mean when it's a range."""
    if e.stagger_values:
        return [float(v) for v in e.stagger_values]
    return [(float(e.value_min) + float(e.value_max)) / 2]


def _stagger_from_elements(
    elements: list[ModeElement], firing_order: dict[UUID, list[int]]
) -> list[float]:
    """The stagger train the PRI Elements make, each at its firing
    position(s); the positions must run 1..N with no gaps or repeats."""
    slots: dict[int, ModeElement] = {}
    for e in elements:
        positions = firing_order.get(e.id)
        if not positions:
            raise CartesianProductError(f"Give PRI Element {_pri_label(e)} its place in the firing order")
        for p in positions:
            if p < 1:
                raise CartesianProductError("Firing order starts at 1")
            if p in slots:
                raise CartesianProductError(
                    f"{_pri_label(slots[p])} and {_pri_label(e)} both fire at position {p}"
                )
            slots[p] = e
    missing = [p for p in range(1, len(slots) + 1) if p not in slots]
    if missing:
        raise CartesianProductError(
            f"The firing order runs 1 to {len(slots)} with no gaps — nothing fires at "
            + ", ".join(str(p) for p in missing)
        )
    values: list[float] = []
    for p in sorted(slots):
        values.extend(_stagger_values_of(slots[p]))
    return values


def _span(ranges: list[tuple[float, float]]) -> tuple[float, float] | None:
    if not ranges:
        return None
    return min(lo for lo, _ in ranges), max(hi for _, hi in ranges)


def _stagger_from_steps(
    selected: list[tuple[ParameterSequence, dict, SequenceStepSelection]],
) -> list[dict]:
    """One stagger train per picked sequence: its picked PRI steps in step
    order (a range at its mean), with the RF and PW its steps span."""
    by_seq: dict[UUID, list[tuple[ParameterSequence, dict, SequenceStepSelection]]] = {}
    for item in selected:
        by_seq.setdefault(item[0].id, []).append(item)
    trains = []
    for items in by_seq.values():
        seq = items[0][0]
        items.sort(key=lambda it: it[1].get("order", 0))
        values = []
        rf_ranges, pw_ranges, rf_deltas, pw_deltas = [], [], [], []
        for _, step, selection in items:
            pri = _step_range(step, "pri_us", "pri_min_us", "pri_max_us")
            if pri is not None:
                values.append((pri[0] + pri[1]) / 2)
            rf = _step_range(step, "rf_mhz", "rf_min_mhz", "rf_max_mhz")
            if rf is not None:
                rf_ranges.append(rf)
                d = selection.rf_delta if selection.rf_delta is not None else seq.rf_delta
                if d is not None:
                    rf_deltas.append(float(d))
            pw = _step_range(step, "pw_us", "pw_min_us", "pw_max_us")
            if pw is not None:
                pw_ranges.append(pw)
                d = selection.pw_delta if selection.pw_delta is not None else seq.pw_delta
                if d is not None:
                    pw_deltas.append(float(d))
        if not values:
            raise CartesianProductError(
                f"Sequence '{seq.label or 'Sequence'}' has no PRI in the picked steps — a stagger needs PRI values"
            )
        trains.append(
            {
                "values": values,
                "rf": _span(rf_ranges),
                "rf_delta": max(rf_deltas) if rf_deltas else None,
                "pw": _span(pw_ranges),
                "pw_delta": max(pw_deltas) if pw_deltas else None,
            }
        )
    return trains


def _fetch_elements(
    db: Session, source_id: UUID | None, ids: list[UUID], expected_type: ElementType
) -> list[ModeElement]:
    """The chosen Elements, checked to be of the type and — unless `source_id`
    is None (the caller checked they're the Emitter's) — from the Source."""
    if not ids:
        raise CartesianProductError(f"At least one {expected_type.value} element must be chosen")
    elements = db.query(ModeElement).filter(ModeElement.id.in_(ids)).all()
    found_ids = {e.id for e in elements}
    missing = set(ids) - found_ids
    if missing:
        raise CartesianProductError(f"Unknown element id(s): {missing}")
    for e in elements:
        if source_id is not None and e.source_id != source_id:
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
    elements_from_any_source: bool = False,
    mode_sources: Callable[[list[ModeElement]], list[Source]] | None = None,
    pri_type: PriType = PriType.fixed,
    pri_firing_order: dict[UUID, list[int]] | None = None,
) -> list[Mode]:
    """Every combination of the chosen RF, PRI (or sequence steps) and PW
    Elements as a Mode. Normally the Elements are the Source's and so is each
    Mode; `elements_from_any_source` takes them from any of the Emitter's
    Sources (checked by the caller), and `mode_sources` gives each Mode its
    Sources from the Elements it was made of.

    With `pri_type` stagger, the PRI Elements in their `pri_firing_order`
    make one stagger train — or each picked sequence's PRI steps make one —
    and every RF × PW combination gets it."""
    if pri_type not in (PriType.fixed, PriType.stagger):
        raise CartesianProductError("Modes can be made with Fixed or Stagger PRI")
    rf_delta_overrides = rf_delta_overrides or {}
    element_source = None if elements_from_any_source else source.id
    pw_delta_overrides = pw_delta_overrides or {}
    pri_delta_overrides = pri_delta_overrides or {}

    # Fetch elements conditionally to avoid errors when sequence steps are used
    rf_elements = _fetch_elements(db, element_source, rf_element_ids, ElementType.rf) if rf_element_ids else [None]
    pw_elements = _fetch_elements(db, element_source, pw_element_ids, ElementType.pw) if pw_element_ids else [None]

    selected_steps = _fetch_selected_steps(db, source.id, sequence_steps) if sequence_steps else []

    # Stagger: the trains (each with the PRI Elements it uses, and the RF/PW
    # its sequence steps span when no RF/PW Elements are picked).
    stagger_trains: list[dict] = []
    if pri_type == PriType.stagger:
        if selected_steps and pri_element_ids:
            raise CartesianProductError("Make the stagger from PRI Elements or from Sequence steps, not both")
        if selected_steps:
            stagger_trains = [{**t, "used": []} for t in _stagger_from_steps(selected_steps)]
        elif pri_element_ids:
            pri_elements = _fetch_elements(db, element_source, pri_element_ids, ElementType.pri)
            values = _stagger_from_elements(pri_elements, pri_firing_order or {})
            stagger_trains = [{"values": values, "rf": None, "pw": None, "used": pri_elements}]
        else:
            raise CartesianProductError(
                "A stagger needs PRI Elements with a firing order, or Sequence steps that set PRI"
            )

    # The "PRI axis" of the cartesian run: either real fetched PRI Elements
    # (no steps selected — the original, element-only path), or the caller's
    # individually-chosen (sequence, step) pairs. Exactly one axis is active
    # per run — selecting steps disables PRI Element selection, same as the
    # old whole-sequence behavior did.
    if stagger_trains:
        pri_axis = []
    elif selected_steps:
        pri_axis: list[
            tuple[ModeElement | None, ParameterSequence | None, dict | None, SequenceStepSelection | None]
        ] = [(None, seq, step, selection) for seq, step, selection in selected_steps]
    else:
        pri_elements = _fetch_elements(db, element_source, pri_element_ids, ElementType.pri)
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

    def _create_mode(pri_type: PriType, line_kwargs: dict, used: list[ModeElement | None]) -> Mode:
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
        if mode_sources is not None:
            set_mode_sources(mode, mode_sources([e for e in used if e is not None]))

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

    for train in stagger_trains:
        for rf_el in rf_elements:
            for pw_el in pw_elements:
                if rf_el:
                    rf_range = (rf_el.value_min, rf_el.value_max)
                    rf_delta = rf_delta_overrides.get(rf_el.id, rf_el.delta)
                else:
                    rf_range, rf_delta = train.get("rf") or (0.0, 0.0), train.get("rf_delta")
                if pw_el:
                    pw_range = (pw_el.value_min, pw_el.value_max)
                    pw_delta = pw_delta_overrides.get(pw_el.id, pw_el.delta)
                else:
                    pw_range, pw_delta = train.get("pw") or (0.0, 0.0), train.get("pw_delta")
                line_kwargs = dict(
                    rf_min_mhz=rf_range[0],
                    rf_max_mhz=rf_range[1],
                    rf_delta=rf_delta,
                    rf_range_matching=rf_range_matching,
                    pw_min_us=pw_range[0],
                    pw_max_us=pw_range[1],
                    pw_delta=pw_delta,
                    pw_range_matching=pw_range_matching,
                    pri_range_matching=pri_range_matching,
                    pri_stagger_values_us=train["values"],
                    # A stagger made here carries no PRI tolerance; edit
                    # the Mode to give its frame time one.
                    frame_time_delta_us=0.0,
                )
                _create_mode(PriType.stagger, line_kwargs, [rf_el, pw_el, *train["used"]])

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

                    _create_mode(PriType.fixed, step_line_kwargs, [rf_el, pw_el])
                else:
                    if pri_type == PriType.stagger:
                        base_line_kwargs["frame_time_delta_us"] = pri_delta_overrides.get(pri_el.id, pri_el.delta)
                    _create_mode(pri_type, base_line_kwargs, [rf_el, pw_el, pri_el])

    db.commit()
    for mode in created:
        db.refresh(mode)
    return created
