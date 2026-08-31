from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.enums import AuditAction, AuditEntityType, ElementType, PriType
from app.dsl.renderer import render_mode_line
from app.models.mode import Mode, ModeElement, ModeGenerationBatch, ModeLine
from app.models.source import Source
from app.services.audit_service import _json_safe, record_audit
from app.services.delta import apply_delta


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


def run_cartesian_product(
    db: Session,
    *,
    source: Source,
    ew_group_id: UUID,
    rf_element_ids: list[UUID],
    pw_element_ids: list[UUID],
    pri_element_ids: list[UUID],
    name_prefix: str,
    created_by: UUID | None = None,
) -> list[Mode]:
    rf_elements = _fetch_elements(db, source.id, rf_element_ids, ElementType.rf)
    pw_elements = _fetch_elements(db, source.id, pw_element_ids, ElementType.pw)
    pri_elements = _fetch_elements(db, source.id, pri_element_ids, ElementType.pri)

    is_stagger = [bool(e.stagger_values) for e in pri_elements]
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

    # Continue sort_order from whatever's already in this EW Group instead of resetting to 1,
    # so repeated cartesian-product runs (and manually-created modes) never collide.
    base_sort_order = db.query(func.max(Mode.sort_order)).filter(Mode.ew_group_id == ew_group_id).scalar() or 0

    created: list[Mode] = []
    counter = 1
    for pri_el in pri_elements:
        pri_type = PriType.stagger if pri_el.stagger_values else PriType.fixed
        for rf_el in rf_elements:
            for pw_el in pw_elements:
                mode = Mode(
                    ew_group_id=ew_group_id,
                    source_id=source.id,
                    name=f"{name_prefix} {counter}",
                    pri_type=pri_type,
                    sort_order=base_sort_order + counter,
                    generation_batch_id=batch.id,
                )
                db.add(mode)
                db.flush()

                rf_min, rf_max = apply_delta(rf_el.value_min, rf_el.value_max, rf_el.delta)
                pw_min, pw_max = apply_delta(pw_el.value_min, pw_el.value_max, pw_el.delta)
                line_kwargs = dict(
                    rf_min_mhz=rf_min,
                    rf_max_mhz=rf_max,
                    pw_min_us=pw_min,
                    pw_max_us=pw_max,
                )
                if pri_type == PriType.stagger:
                    line_kwargs["pri_stagger_values_us"] = pri_el.stagger_values
                else:
                    pri_min, pri_max = apply_delta(pri_el.value_min, pri_el.value_max, pri_el.delta)
                    line_kwargs.update(
                        pri_min_us=pri_min,
                        pri_max_us=pri_max,
                        jitter_min_us=pri_el.jitter_min,
                        jitter_max_us=pri_el.jitter_max,
                    )

                dsl_text = render_mode_line(pri_type=pri_type, **line_kwargs)
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
                counter += 1

    db.commit()
    for mode in created:
        db.refresh(mode)
    return created
