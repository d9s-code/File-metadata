"""Linking a Mode to one of its Emitter's operational modes, or either to one of its scans."""

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.emitter_scan import EmitterScan
from app.models.operational_mode import OperationalMode


def check_operational_mode(db: Session, emitter_id: UUID, operational_mode_id: UUID | None) -> None:
    """Raises unless it's one of this Emitter's operational modes (None — no link — is fine)."""
    if operational_mode_id is None:
        return
    row = db.get(OperationalMode, operational_mode_id)
    if row is None or row.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That operational mode isn't one of this Emitter's")


def check_scan(db: Session, emitter_id: UUID, scan_id: UUID | None) -> None:
    """Raises unless it's one of this Emitter's scans (None — none of its own — is fine)."""
    if scan_id is None:
        return
    row = db.get(EmitterScan, scan_id)
    if row is None or row.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That scan isn't one of this Emitter's")


def name_the_change(db: Session, changes: dict) -> dict:
    """An audit diff's operational_mode_id and scan_id as their names."""
    for key, model, label in (("operational_mode_id", OperationalMode, "operational_mode"), ("scan_id", EmitterScan, "scan")):
        change = changes.pop(key, None)
        if change is None:
            continue

        def name(raw, model=model) -> str | None:
            row = db.get(model, UUID(str(raw))) if raw else None
            return row.name if row else None

        changes[label] = {"old": name(change.get("old")), "new": name(change.get("new"))}
    return changes
