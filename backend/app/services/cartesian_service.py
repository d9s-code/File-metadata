from uuid import UUID

from sqlalchemy.orm import Session

from app.core.enums import ElementType, PriType
from app.dsl.renderer import render_mode_line
from app.models.mode import Mode, ModeElement, ModeLine
from app.models.source import Source
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
                    sort_order=counter,
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
                created.append(mode)
                counter += 1

    db.commit()
    for mode in created:
        db.refresh(mode)
    return created
