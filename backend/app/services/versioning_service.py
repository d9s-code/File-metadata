"""Generic version-commit/list/diff engine shared by every versioned entity
(Emitter now; Platform and MDF register against the same engine in later
phases) — the commit/list/diff logic lives here exactly once; each entity
type just supplies its SQLAlchemy version model, the FK column name that
points back to the live entity, and a snapshot-builder callback.
"""

from dataclasses import dataclass
from typing import Any, Callable, Type
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.services.diffing import compute_diff


@dataclass
class VersionSpec:
    version_model: Type[Any]
    entity_fk_field: str


def commit_version(
    db: Session,
    *,
    spec: VersionSpec,
    entity_id: UUID,
    snapshot: dict,
    change_summary: str | None,
    created_by: UUID | None,
) -> Any:
    fk = {spec.entity_fk_field: entity_id}
    last_version_number = (
        db.query(func.max(spec.version_model.version_number)).filter_by(**fk).scalar() or 0
    )
    version = spec.version_model(
        version_number=last_version_number + 1,
        snapshot=snapshot,
        change_summary=change_summary,
        created_by=created_by,
        **fk,
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    return version


def list_versions(db: Session, *, spec: VersionSpec, entity_id: UUID) -> list[Any]:
    fk_column = getattr(spec.version_model, spec.entity_fk_field)
    return (
        db.query(spec.version_model)
        .filter(fk_column == entity_id)
        .order_by(spec.version_model.version_number)
        .all()
    )


def get_version(db: Session, *, spec: VersionSpec, entity_id: UUID, version_number: int) -> Any | None:
    fk_column = getattr(spec.version_model, spec.entity_fk_field)
    return (
        db.query(spec.version_model)
        .filter(fk_column == entity_id, spec.version_model.version_number == version_number)
        .first()
    )


def diff_versions(
    db: Session, *, spec: VersionSpec, entity_id: UUID, from_version: int, to_version: int
) -> dict:
    old = get_version(db, spec=spec, entity_id=entity_id, version_number=from_version)
    new = get_version(db, spec=spec, entity_id=entity_id, version_number=to_version)
    if old is None or new is None:
        raise ValueError("One or both versions not found")
    return compute_diff(old.snapshot, new.snapshot)


SnapshotBuilder = Callable[[Any], dict]
