from sqlalchemy.orm import Session

from app.core.enums import ElementType, PriType
from app.dsl.parser import ParsedModeLine, parse_mode_line
from app.models.mode import Mode, ModeElement, ModeLine
from app.models.source import Source


def _find_or_create_element(db: Session, source_id, element_type: ElementType, **fields) -> ModeElement:
    query = db.query(ModeElement).filter(
        ModeElement.source_id == source_id, ModeElement.element_type == element_type
    )
    for key, value in fields.items():
        query = query.filter(getattr(ModeElement, key) == value)
    existing = query.first()
    if existing is not None:
        return existing
    element = ModeElement(source_id=source_id, element_type=element_type, **fields)
    db.add(element)
    db.flush()
    return element


def upsert_elements_from_parsed_line(db: Session, source: Source, parsed: ParsedModeLine) -> None:
    """Derives RF/PW/PRI elements from a typed mode line and adds any that
    aren't already present in the Source's element pool — the "text derives
    elements" direction of mode construction.
    """
    _find_or_create_element(
        db, source.id, ElementType.rf, value_min=parsed.rf_min_mhz, value_max=parsed.rf_max_mhz
    )
    _find_or_create_element(
        db, source.id, ElementType.pw, value_min=parsed.pw_min_us, value_max=parsed.pw_max_us
    )
    if parsed.pri_type == PriType.fixed:
        _find_or_create_element(
            db,
            source.id,
            ElementType.pri,
            value_min=parsed.pri_min_us,
            value_max=parsed.pri_max_us,
            jitter_min=parsed.jitter_min_us,
            jitter_max=parsed.jitter_max_us,
        )
    elif parsed.pri_type == PriType.stagger:
        _find_or_create_element(
            db, source.id, ElementType.pri, stagger_values=parsed.pri_stagger_values_us
        )
    # CW/Xlet carry no PRI value, so there is no PRI element to derive.


def create_mode_from_dsl(
    db: Session,
    *,
    source: Source,
    ew_group_id,
    name: str,
    dsl_text: str,
    notes: str | None = None,
    sort_order: int = 0,
) -> Mode:
    parsed = parse_mode_line(dsl_text)

    mode = Mode(
        ew_group_id=ew_group_id,
        source_id=source.id,
        name=name,
        pri_type=parsed.pri_type,
        notes=notes,
        sort_order=sort_order,
    )
    db.add(mode)
    db.flush()

    db.add(
        ModeLine(
            mode_id=mode.id,
            rf_min_mhz=parsed.rf_min_mhz,
            rf_max_mhz=parsed.rf_max_mhz,
            pw_min_us=parsed.pw_min_us,
            pw_max_us=parsed.pw_max_us,
            pri_min_us=parsed.pri_min_us,
            pri_max_us=parsed.pri_max_us,
            jitter_min_us=parsed.jitter_min_us,
            jitter_max_us=parsed.jitter_max_us,
            pri_stagger_values_us=parsed.pri_stagger_values_us or None,
            dsl_text=dsl_text,
        )
    )

    upsert_elements_from_parsed_line(db, source, parsed)

    db.commit()
    db.refresh(mode)
    return mode
