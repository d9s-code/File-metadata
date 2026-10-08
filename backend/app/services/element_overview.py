"""Every distinct Element across an Emitter's Sources: the same values in
several Sources (or twice in one) are one row, listing where each is."""

from uuid import UUID

from sqlalchemy.orm import Session

from app.models.mode import ModeElement
from app.models.source import Source


def _num(v):
    return None if v is None else float(v)


def element_overview(db: Session, emitter_id: UUID) -> list[dict]:
    rows = (
        db.query(ModeElement, Source)
        .join(Source, ModeElement.source_id == Source.id)
        .filter(Source.emitter_id == emitter_id)
        .all()
    )
    groups: dict[tuple, dict] = {}
    for element, source in rows:
        stagger = tuple(float(v) for v in element.stagger_values) if element.stagger_values else None
        key = (
            element.element_type.value,
            _num(element.value_min),
            _num(element.value_max),
            stagger,
            _num(element.jitter_min),
            _num(element.jitter_max),
        )
        group = groups.setdefault(
            key,
            {
                "element_type": key[0],
                "value_min": key[1],
                "value_max": key[2],
                "stagger_values": list(stagger) if stagger else None,
                "jitter_min": key[4],
                "jitter_max": key[5],
                "occurrences": [],
            },
        )
        group["occurrences"].append(
            {
                "element_id": element.id,
                "source_id": source.id,
                "source_name": source.name,
                "source_status": source.status.value,
                "variant": element.variant.value if element.variant else None,
                "label": element.label,
                "delta": _num(element.delta),
            }
        )
    order = {"rf": 0, "pri": 1, "pw": 2, "scan": 3}

    def sort_key(g: dict):
        first = g["value_min"] if g["value_min"] is not None else (g["stagger_values"] or [0])[0]
        return (order.get(g["element_type"], 9), first, g["value_max"] or 0)

    return sorted(groups.values(), key=sort_key)
