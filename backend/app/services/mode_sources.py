"""A Mode's Sources: one or more, all equal — Mode.source_id holds the first
and ModeExtraSource rows the rest, in order."""

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.mode import Mode, ModeExtraSource
from app.models.source import Source


def resolve_sources(db: Session, *, emitter_id: UUID, source_ids: list[UUID]) -> list[Source]:
    """The given Sources, in order and without repeats — all of them in this Emitter."""
    ordered = list(dict.fromkeys(source_ids))
    if not ordered:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A Mode needs at least one Source")
    sources = []
    for source_id in ordered:
        source = db.get(Source, source_id)
        if source is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found")
        if source.emitter_id != emitter_id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "Source and EW Group must belong to the same Emitter"
            )
        sources.append(source)
    return sources


def set_mode_sources(mode: Mode, sources: list[Source]) -> None:
    mode.source_id = sources[0].id
    mode.source = sources[0]
    mode.extra_source_links = [
        ModeExtraSource(source_id=s.id, source=s, sort_order=i) for i, s in enumerate(sources[1:])
    ]


def add_mode_sources(mode: Mode, sources: list[Source]) -> None:
    """Adds the given Sources after the Mode's own, skipping ones it already has."""
    have = set(mode.source_ids)
    set_mode_sources(mode, [*mode.sources, *(s for s in sources if s.id not in have)])


def sources_label(names: list[str]) -> str:
    return ", ".join(names)


def all_rejected(source_ids: list[str], rejected: set[str]) -> bool:
    """A Mode is left out of exports and checks only when every Source it
    comes from was rejected — one approved Source is enough to keep it."""
    return all(sid in rejected for sid in source_ids)


def mode_source_ids(mode_snapshot: dict) -> list[str]:
    """Every Source id of a snapshotted Mode (snapshots from before Modes had
    several Sources carry only source_id)."""
    return [mode_snapshot["source_id"], *mode_snapshot.get("extra_source_ids", [])]
