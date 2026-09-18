from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_role
from app.models.emitter import Emitter
from app.models.intercept import Intercept, InterceptEntry, InterceptEntryMode, InterceptNote
from app.schemas.intercept import (
    InterceptCreate,
    InterceptEntryCreate,
    InterceptEntryOut,
    InterceptNoteCreate,
    InterceptNoteOut,
    InterceptOut,
    InterceptUpdate,
)
from app.services.audit_service import apply_and_diff, record_audit, snapshot

router = APIRouter(prefix="/intercepts", tags=["intercepts"])


def _get_intercept_or_404(db: Session, intercept_id: UUID) -> Intercept:
    intercept = db.get(Intercept, intercept_id)
    if intercept is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Intercept not found")
    return intercept


def _check_emitter(db: Session, emitter_id: UUID) -> None:
    if db.get(Emitter, emitter_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")


def _attach_entry_count(db: Session, intercept: Intercept) -> Intercept:
    intercept.entry_count = (
        db.query(func.count(InterceptEntry.id)).filter(InterceptEntry.intercept_id == intercept.id).scalar() or 0
    )
    return intercept


def _attach_derived_mode_ids(db: Session, entries: list[InterceptEntry]) -> list[InterceptEntryOut]:
    entry_ids = [e.id for e in entries]
    mode_ids_by_entry: dict[UUID, list[UUID]] = {}
    if entry_ids:
        rows = (
            db.query(InterceptEntryMode.intercept_entry_id, InterceptEntryMode.mode_id)
            .filter(InterceptEntryMode.intercept_entry_id.in_(entry_ids))
            .all()
        )
        for entry_id, mode_id in rows:
            mode_ids_by_entry.setdefault(entry_id, []).append(mode_id)
    results = []
    for e in entries:
        out = InterceptEntryOut.model_validate(e)
        out.derived_mode_ids = mode_ids_by_entry.get(e.id, [])
        results.append(out)
    return results


@router.get("", response_model=list[InterceptOut])
def list_intercepts(
    emitter_id: UUID | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> list[Intercept]:
    query = (
        db.query(Intercept, func.count(InterceptEntry.id).label("entry_count"))
        .outerjoin(InterceptEntry, InterceptEntry.intercept_id == Intercept.id)
        .group_by(Intercept.id)
        .order_by(Intercept.name)
    )
    if emitter_id is not None:
        query = query.filter(Intercept.emitter_id == emitter_id)
    if search:
        query = query.filter(Intercept.name.ilike(f"%{search}%"))
    results = []
    for intercept, entry_count in query.all():
        intercept.entry_count = entry_count
        results.append(intercept)
    return results


@router.get("/{intercept_id}", response_model=InterceptOut)
def get_intercept(
    intercept_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> Intercept:
    return _attach_entry_count(db, _get_intercept_or_404(db, intercept_id))


@router.post("", response_model=InterceptOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
def create_intercept(
    payload: InterceptCreate, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> Intercept:
    _check_emitter(db, payload.emitter_id)
    intercept = Intercept(emitter_id=payload.emitter_id, name=payload.name, description=payload.description)
    db.add(intercept)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.intercept.value,
        entity_id=intercept.id,
        summary=f"Created Intercept '{intercept.name}'",
        changes=payload.model_dump(mode="json"),
        emitter_id=intercept.emitter_id,
    )
    db.commit()
    db.refresh(intercept)
    return _attach_entry_count(db, intercept)


@router.patch("/{intercept_id}", response_model=InterceptOut, dependencies=[Depends(verify_csrf)])
def update_intercept(
    intercept_id: UUID,
    payload: InterceptUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> Intercept:
    intercept = _get_intercept_or_404(db, intercept_id)
    changes = apply_and_diff(intercept, payload.model_dump(exclude_unset=True))
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.intercept.value,
        entity_id=intercept.id,
        summary=f"Updated Intercept '{intercept.name}'",
        changes=changes,
        emitter_id=intercept.emitter_id,
    )
    db.commit()
    db.refresh(intercept)
    return _attach_entry_count(db, intercept)


@router.delete("/{intercept_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_intercept(
    intercept_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> None:
    intercept = _get_intercept_or_404(db, intercept_id)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.intercept.value,
        entity_id=intercept.id,
        summary=f"Deleted Intercept '{intercept.name}'",
        changes=snapshot(intercept, ["name", "description", "emitter_id"]),
        emitter_id=intercept.emitter_id,
    )
    db.delete(intercept)
    db.commit()


@router.get("/{intercept_id}/notes", response_model=list[InterceptNoteOut])
def list_intercept_notes(
    intercept_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[InterceptNote]:
    _get_intercept_or_404(db, intercept_id)
    return (
        db.query(InterceptNote)
        .options(joinedload(InterceptNote.author))
        .filter(InterceptNote.intercept_id == intercept_id)
        .order_by(InterceptNote.created_at.desc())
        .all()
    )


@router.post(
    "/{intercept_id}/notes",
    response_model=InterceptNoteOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def create_intercept_note(
    intercept_id: UUID,
    payload: InterceptNoteCreate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> InterceptNote:
    intercept = _get_intercept_or_404(db, intercept_id)
    note = InterceptNote(intercept_id=intercept_id, author_id=user.id, body=payload.body)
    db.add(note)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.intercept_note.value,
        entity_id=note.id,
        summary=f"Added a note to Intercept '{intercept.name}'",
        emitter_id=intercept.emitter_id,
    )
    db.commit()
    db.refresh(note)
    return note


@router.delete(
    "/{intercept_id}/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)]
)
def delete_intercept_note(
    intercept_id: UUID,
    note_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> None:
    intercept = _get_intercept_or_404(db, intercept_id)
    note = db.get(InterceptNote, note_id)
    if note is None or note.intercept_id != intercept_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found")
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.intercept_note.value,
        entity_id=note.id,
        summary=f"Deleted a note from Intercept '{intercept.name}'",
        changes=snapshot(note, ["body"]),
        emitter_id=intercept.emitter_id,
    )
    db.delete(note)
    db.commit()


@router.get("/{intercept_id}/entries", response_model=list[InterceptEntryOut])
def list_intercept_entries(
    intercept_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[InterceptEntryOut]:
    _get_intercept_or_404(db, intercept_id)
    entries = (
        db.query(InterceptEntry)
        .filter(InterceptEntry.intercept_id == intercept_id)
        .order_by(InterceptEntry.created_at.desc())
        .all()
    )
    return _attach_derived_mode_ids(db, entries)


@router.post(
    "/{intercept_id}/entries",
    response_model=InterceptEntryOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def create_intercept_entry(
    intercept_id: UUID,
    payload: InterceptEntryCreate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> InterceptEntryOut:
    intercept = _get_intercept_or_404(db, intercept_id)
    entry = InterceptEntry(intercept_id=intercept_id, **payload.model_dump())
    db.add(entry)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.intercept_entry.value,
        entity_id=entry.id,
        summary=f"Added an entry to Intercept '{intercept.name}'",
        changes=payload.model_dump(mode="json"),
        emitter_id=intercept.emitter_id,
    )
    db.commit()
    db.refresh(entry)
    return _attach_derived_mode_ids(db, [entry])[0]


@router.post(
    "/{intercept_id}/entries/bulk",
    response_model=list[InterceptEntryOut],
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def bulk_create_intercept_entries(
    intercept_id: UUID,
    payload: list[InterceptEntryCreate],
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> list[InterceptEntryOut]:
    """All-or-nothing bulk entry creation — the entry point a future import
    flow will call once the source format is known. Every row is validated
    by InterceptEntryCreate the same way a single POST is (FastAPI rejects
    the whole request with 422 if any row is invalid, before this body runs).
    """
    intercept = _get_intercept_or_404(db, intercept_id)
    entries = [InterceptEntry(intercept_id=intercept_id, **item.model_dump()) for item in payload]
    db.add_all(entries)
    db.flush()
    for entry, item in zip(entries, payload):
        record_audit(
            db,
            actor_id=user.id,
            action=AuditAction.create,
            entity_type=AuditEntityType.intercept_entry.value,
            entity_id=entry.id,
            summary=f"Added an entry to Intercept '{intercept.name}' (bulk import)",
            changes=item.model_dump(mode="json"),
            emitter_id=intercept.emitter_id,
        )
    db.commit()
    for entry in entries:
        db.refresh(entry)
    return _attach_derived_mode_ids(db, entries)


@router.delete(
    "/{intercept_id}/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)]
)
def delete_intercept_entry(
    intercept_id: UUID,
    entry_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> None:
    intercept = _get_intercept_or_404(db, intercept_id)
    entry = db.get(InterceptEntry, entry_id)
    if entry is None or entry.intercept_id != intercept_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found")
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.intercept_entry.value,
        entity_id=entry.id,
        summary=f"Deleted an entry from Intercept '{intercept.name}'",
        changes=snapshot(
            entry,
            [
                "pri_type",
                "rf_min_mhz",
                "rf_max_mhz",
                "rf_mean_mhz",
                "pw_min_us",
                "pw_max_us",
                "pw_mean_us",
                "pri_min_us",
                "pri_max_us",
                "pri_mean_us",
                "jitter_mean_us",
                "stagger_values",
                "notes",
            ],
        ),
        emitter_id=intercept.emitter_id,
    )
    db.delete(entry)
    db.commit()
