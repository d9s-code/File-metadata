"""All Sources: every Element of an Emitter's Sources as one merged pool —
the same values in several Sources are one Element (as in the Element
overview) — and Modes generated from it, each Mode given the Sources its
Elements were found in."""

from collections import Counter
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.mode import ModeElement
from app.models.source import Source
from app.services.cartesian_service import CartesianProductError
from app.services.element_overview import element_key, emitter_elements


class MergedPool:
    """The Emitter's Elements by merge key, and for any one of them the
    Element that stands for its group in a run."""

    def __init__(self, db: Session, emitter_id: UUID):
        self.groups: dict[tuple, list[tuple[ModeElement, Source]]] = {}
        self.key_of: dict[UUID, tuple] = {}
        for element, source in emitter_elements(db, emitter_id):
            key = element_key(element)
            self.groups.setdefault(key, []).append((element, source))
            self.key_of[element.id] = key
        # The same order everywhere: by Source name.
        for members in self.groups.values():
            members.sort(key=lambda m: (m[1].name.lower(), str(m[0].id)))

    def representative(self, element_id: UUID) -> ModeElement:
        key = self.key_of.get(element_id)
        if key is None:
            raise CartesianProductError(f"Element {element_id} isn't in any of this Emitter's Sources")
        return self.groups[key][0][0]

    def members(self, element: ModeElement) -> list[tuple[ModeElement, Source]]:
        return self.groups[self.key_of[element.id]]

    def sources_of(self, elements: list[ModeElement]) -> list[Source]:
        """The Sources a combination's Elements were found in — those holding
        most of them first."""
        counts: Counter = Counter()
        by_id: dict[UUID, Source] = {}
        for element in elements:
            for source in {s.id: s for _, s in self.members(element)}.values():
                counts[source.id] += 1
                by_id[source.id] = source
        return sorted(by_id.values(), key=lambda s: (-counts[s.id], s.name.lower()))

    def default_delta(self, element: ModeElement) -> float | None:
        """A merged Element's margin when the run doesn't set one: the widest
        any of its Sources gives."""
        deltas = [float(e.delta) for e, _ in self.members(element) if e.delta is not None]
        return max(deltas) if deltas else None


def resolve_selection(pool: MergedPool, ids: list[UUID], overrides: dict[UUID, float] | None):
    """The chosen Elements as one per merged group (any of a group's Elements
    picks the group), and each one's margin for the run: the one asked for on
    any Element of its group, else the widest its Sources give."""
    reps: dict[UUID, ModeElement] = {}
    for element_id in ids:
        rep = pool.representative(element_id)
        reps.setdefault(rep.id, rep)
    deltas: dict[UUID, float] = {}
    overrides = overrides or {}
    for rep in reps.values():
        asked = [overrides[e.id] for e, _ in pool.members(rep) if e.id in overrides]
        delta = asked[0] if asked else pool.default_delta(rep)
        if delta is not None:
            deltas[rep.id] = delta
    return list(reps), deltas


def batch_source(pool: MergedPool, reps: list[ModeElement]) -> Source:
    """The Source a run is filed under (its batch and generation log): the
    one holding most of the chosen Elements."""
    sources = pool.sources_of(reps)
    if not sources:
        raise CartesianProductError("Choose at least one Element")
    return sources[0]
