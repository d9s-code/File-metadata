"""Linking a Mode to one of its Emitter's operational modes."""

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.operational_mode import OperationalMode


def check_operational_mode(db: Session, emitter_id: UUID, operational_mode_id: UUID | None) -> None:
    """Raises unless it's one of this Emitter's operational modes (None — no link — is fine)."""
    if operational_mode_id is None:
        return
    row = db.get(OperationalMode, operational_mode_id)
    if row is None or row.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That operational mode isn't one of this Emitter's")


def name_the_change(db: Session, changes: dict) -> dict:
    """An audit diff's operational_mode_id as the operational modes' names."""
    change = changes.pop("operational_mode_id", None)
    if change is not None:

        def name(raw) -> str | None:
            row = db.get(OperationalMode, UUID(str(raw))) if raw else None
            return row.name if row else None

        changes["operational_mode"] = {"old": name(change.get("old")), "new": name(change.get("new"))}
    return changes
