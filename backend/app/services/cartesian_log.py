"""Logs each cartesian Mode generation run on its Source — see CartesianRun."""

from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.cartesian_run import CartesianRun
from app.models.ew_group import EwGroup
from app.models.mode import Mode, ModeElement
from app.models.parameter_sequence import ParameterSequence
from app.models.source import Source
from app.schemas.mode_element import CartesianProductRequest


def _num(v):
    return None if v is None else float(v)


def record_cartesian_run(
    db: Session,
    *,
    source: Source,
    ew_group: EwGroup,
    payload: CartesianProductRequest,
    created: list[Mode],
    user_id: UUID | None,
) -> CartesianRun:
    overrides = {
        **(payload.rf_delta_overrides or {}),
        **(payload.pw_delta_overrides or {}),
        **(payload.pri_delta_overrides or {}),
    }
    ids = [*payload.rf_element_ids, *payload.pri_element_ids, *payload.pw_element_ids]
    by_id = {e.id: e for e in db.query(ModeElement).filter(ModeElement.id.in_(ids)).all()} if ids else {}
    elements = []
    for element_id in ids:
        e = by_id.get(element_id)
        if e is None:
            continue
        delta = overrides.get(element_id, e.delta)
        elements.append(
            {
                "element_type": e.element_type.value,
                "label": e.label,
                "variant": e.variant.value if e.variant else None,
                "value_min": _num(e.value_min),
                "value_max": _num(e.value_max),
                "stagger_values": [float(v) for v in e.stagger_values] if e.stagger_values else None,
                "jitter_min": _num(e.jitter_min),
                "jitter_max": _num(e.jitter_max),
                "delta": _num(delta),
                "delta_overridden": element_id in overrides,
            }
        )
    steps = []
    for selection in payload.sequence_steps or []:
        seq = db.get(ParameterSequence, selection.sequence_id)
        if seq is None:
            continue
        step = next((s for s in seq.steps if s.get("order") == selection.order), {})
        steps.append(
            {
                "sequence_label": seq.label,
                "variant": seq.variant.value if seq.variant else None,
                "order": selection.order,
                "values": {k: v for k, v in step.items() if k != "order" and v is not None},
                "rf_delta": selection.rf_delta if selection.rf_delta is not None else _num(seq.rf_delta),
                "pw_delta": selection.pw_delta if selection.pw_delta is not None else _num(seq.pw_delta),
                "pri_delta": selection.pri_delta if selection.pri_delta is not None else _num(seq.pri_delta),
            }
        )
    run = CartesianRun(
        source_id=source.id,
        batch_id=created[0].generation_batch_id if created else None,
        ew_group_name=ew_group.name,
        name_prefix=payload.name_prefix,
        note=payload.batch_note or None,
        inputs={
            "elements": elements,
            "sequence_steps": steps,
            "range_matching": {
                "rf": payload.rf_range_matching,
                "pri": payload.pri_range_matching,
                "pw": payload.pw_range_matching,
            },
        },
        mode_names=[m.name for m in created],
        created_by=user_id,
    )
    db.add(run)
    return run


def modes_remaining(db: Session, runs: list[CartesianRun]) -> dict[UUID, int]:
    """How many of each run's Modes are still there, by batch."""
    batch_ids = [r.batch_id for r in runs if r.batch_id]
    if not batch_ids:
        return {}
    rows = (
        db.query(Mode.generation_batch_id, func.count(Mode.id))
        .filter(Mode.generation_batch_id.in_(batch_ids))
        .group_by(Mode.generation_batch_id)
        .all()
    )
    return dict(rows)
