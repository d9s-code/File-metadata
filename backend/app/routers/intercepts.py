import csv
import io
import json
import uuid as uuid_mod
from collections import Counter
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import Field
from sqlalchemy import bindparam, func, select, text, update
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Session, joinedload

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, PriType, Role
from app.database import get_db
from app.deps import require_role
from app.models.emitter import Emitter
from app.models.ew_group import EwGroup
from app.models.intercept import Intercept, InterceptEntry, InterceptEntryMode, InterceptNote, InterceptReport
from app.models.mode import Mode
from app.schemas.intercept import (
    PROVENANCE_FIELDS,
    EntryIds,
    REPORT_ROW_FIELDS,
    InterceptCreate,
    InterceptEntriesImport,
    InterceptEntryCreate,
    InterceptEntryOut,
    InterceptImport,
    InterceptReportOut,
    InterceptReportPage,
    RegroupRequest,
    RegroupResult,
    ReportsUpload,
    InterceptMatchCounts,
    MAX_IMPORT_ENTRIES,
    InterceptNoteCreate,
    InterceptNoteOut,
    InterceptOut,
    InterceptUpdate,
    MatchCounts,
    SourceFileImport,
)
from app.services.audit_service import apply_and_diff, record_audit, snapshot
from app.services.intercept_match_service import entry_status, mode_ranges

router = APIRouter(prefix="/intercepts", tags=["intercepts"])


def _get_intercept_or_404(db: Session, intercept_id: UUID) -> Intercept:
    intercept = db.get(Intercept, intercept_id)
    if intercept is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Intercept not found")
    return intercept


def _check_emitter(db: Session, emitter_id: UUID) -> None:
    emitter = db.get(Emitter, emitter_id)
    if emitter is None or emitter.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")


def _get_writable_intercept(db: Session, intercept_id: UUID) -> Intercept:
    """An Intercept that can be changed — not one whose Emitter was deleted
    (it waits in the trash with its Emitter, read-only)."""
    intercept = _get_intercept_or_404(db, intercept_id)
    _check_emitter(db, intercept.emitter_id)
    return intercept


# Kept in an entry's audit snapshot: enough to see what was there.
ENTRY_SNAPSHOT_FIELDS = [
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
    "report_count",
    "source_file",
]


def _record_entries_added(db: Session, user, intercept: Intercept, entries: list[InterceptEntry], how: str) -> None:
    """One audit row for entries added together — an import of thousands
    would otherwise bury the log. Says how many, and from which files."""
    files = sorted({e.source_file for e in entries if e.source_file})
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.intercept.value,
        entity_id=intercept.id,
        summary=f"Added {len(entries)} entr{'y' if len(entries) == 1 else 'ies'} to Intercept '{intercept.name}' ({how})",
        changes={"entry_count": len(entries), "source_files": files},
        emitter_id=intercept.emitter_id,
    )


def _attach_entry_count(db: Session, intercept: Intercept) -> Intercept:
    intercept.entry_count = (
        db.query(func.count(InterceptEntry.id)).filter(InterceptEntry.intercept_id == intercept.id).scalar() or 0
    )
    intercept.report_count = (
        db.query(func.count(InterceptReport.id)).filter(InterceptReport.intercept_id == intercept.id).scalar() or 0
    )
    return intercept


def _store_reports(db: Session, intercept: Intercept, entries: list[InterceptEntry], upload: ReportsUpload | None) -> int:
    """Saves an import's reports, each linked to the entry it went into (the
    entries must be flushed, so they have ids). Inserted in one statement —
    a file can hold tens of thousands."""
    if upload is None or not upload.rows:
        return 0
    columns = ("id", "intercept_id", "entry_id", "source_file") + REPORT_ROW_FIELDS
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    for row in upload.rows:
        entry_index = row[-1]
        writer.writerow(
            [
                _copy_cell(v)
                for v in (
                    uuid_mod.uuid4(),
                    intercept.id,
                    None if entry_index is None else entries[entry_index].id,
                    upload.source_file,
                    *row[:-1],
                )
            ]
        )
    buffer.seek(0)
    # COPY rather than INSERT: about four times quicker for a large file, in
    # the same transaction as the rest of the import.
    with db.connection().connection.cursor() as cursor:
        cursor.copy_expert(
            f"COPY intercept_reports ({', '.join(columns)}) FROM STDIN WITH (FORMAT csv, NULL '{_COPY_NULL}')",
            buffer,
        )
    intercept.grouping_version += 1
    return len(upload.rows)


_COPY_NULL = "\\N"


def _copy_cell(v):
    """A value as COPY's CSV format reads it."""
    if v is None:
        return _COPY_NULL
    if isinstance(v, list):
        return "{" + ",".join(repr(float(x)) for x in v) + "}"
    if hasattr(v, "isoformat"):
        return v.isoformat()
    if isinstance(v, PriType):
        return v.value
    return v


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
        .join(Emitter, Emitter.id == Intercept.emitter_id)
        .filter(Emitter.is_deleted.is_(False))
        .group_by(Intercept.id)
        .order_by(Intercept.intercepted_on.desc().nulls_last(), Intercept.name)
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


@router.get("/entries", response_model=list[InterceptEntryOut])
def list_emitter_intercept_entries(
    emitter_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[InterceptEntryOut]:
    """Every entry of every Intercept on one Emitter — what the Emitter's
    Intercepts tab needs to say how many entries match a Mode, in one call.
    Declared before /{intercept_id} so "entries" isn't read as an id."""
    entries = (
        db.query(InterceptEntry)
        .join(Intercept, Intercept.id == InterceptEntry.intercept_id)
        .filter(Intercept.emitter_id == emitter_id)
        .order_by(InterceptEntry.created_at.desc())
        .all()
    )
    return _attach_derived_mode_ids(db, entries)


@router.get("/match-counts", response_model=InterceptMatchCounts)
def emitter_match_counts(
    emitter_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> InterceptMatchCounts:
    """How each of an Emitter's Intercepts compares with its Modes: entries
    that match a Mode, nearly do, or don't (see intercept_match_service)."""
    modes = mode_ranges(
        db.query(Mode).join(EwGroup, Mode.ew_group_id == EwGroup.id).filter(EwGroup.emitter_id == emitter_id).all()
    )
    entries = (
        db.query(InterceptEntry)
        .join(Intercept, Intercept.id == InterceptEntry.intercept_id)
        .filter(Intercept.emitter_id == emitter_id)
        .all()
    )
    total = MatchCounts()
    by_intercept: dict[UUID, MatchCounts] = {}
    for entry in entries:
        result = entry_status(entry, modes)
        counts = by_intercept.setdefault(entry.intercept_id, MatchCounts())
        setattr(counts, result, getattr(counts, result) + 1)
        setattr(total, result, getattr(total, result) + 1)
    return InterceptMatchCounts(total=total, by_intercept=by_intercept)


@router.get("/source-files", response_model=list[SourceFileImport])
def find_source_file_imports(
    name: str, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[SourceFileImport]:
    """Intercepts already holding entries imported from a file of this name —
    the import page warns before the same file goes in twice."""
    rows = (
        db.query(Intercept, func.count(InterceptEntry.id), func.max(InterceptEntry.created_at))
        .join(InterceptEntry, InterceptEntry.intercept_id == Intercept.id)
        .filter(InterceptEntry.source_file == name)
        .group_by(Intercept.id)
        .order_by(func.max(InterceptEntry.created_at).desc())
        .all()
    )
    return [
        SourceFileImport(
            intercept_id=i.id, intercept_name=i.name, emitter_id=i.emitter_id, entry_count=n, imported_at=at
        )
        for i, n, at in rows
    ]


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
    intercept = Intercept(**payload.model_dump())
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


@router.post(
    "/import", response_model=InterceptOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)]
)
def import_intercept(
    payload: InterceptImport, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> Intercept:
    """Creates an Intercept with all its entries in one transaction — the CSV
    import's save. Every entry is validated like a single POST before
    anything is written, so a bad row leaves no half-imported Intercept."""
    _check_emitter(db, payload.intercept.emitter_id)
    intercept = Intercept(**payload.intercept.model_dump())
    db.add(intercept)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.intercept.value,
        entity_id=intercept.id,
        summary=f"Created Intercept '{intercept.name}' (import)",
        changes=payload.intercept.model_dump(mode="json"),
        emitter_id=intercept.emitter_id,
    )
    entries = [InterceptEntry(intercept_id=intercept.id, **item.model_dump()) for item in payload.entries]
    db.add_all(entries)
    db.flush()
    _store_reports(db, intercept, entries, payload.reports)
    _record_entries_added(db, user, intercept, entries, "import")
    db.commit()
    db.refresh(intercept)
    return _attach_entry_count(db, intercept)


@router.post(
    "/{intercept_id}/import", response_model=InterceptOut, dependencies=[Depends(verify_csrf)]
)
def import_into_intercept(
    intercept_id: UUID,
    payload: InterceptEntriesImport,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> Intercept:
    """Adds a file's entries, and the reports they were grouped from, to an
    existing Intercept — all or nothing."""
    intercept = _get_writable_intercept(db, intercept_id)
    entries = [InterceptEntry(intercept_id=intercept.id, **item.model_dump()) for item in payload.entries]
    db.add_all(entries)
    db.flush()
    _store_reports(db, intercept, entries, payload.reports)
    _record_entries_added(db, user, intercept, entries, "import")
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
    intercept = _get_writable_intercept(db, intercept_id)
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
    intercept = _get_writable_intercept(db, intercept_id)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.intercept.value,
        entity_id=intercept.id,
        summary=f"Deleted Intercept '{intercept.name}'",
        changes=snapshot(intercept, ["name", "description", "intercepted_on", "collected_by", "emitter_id"]),
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
    intercept = _get_writable_intercept(db, intercept_id)
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
    intercept = _get_writable_intercept(db, intercept_id)
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
    intercept = _get_writable_intercept(db, intercept_id)
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
    payload: Annotated[list[InterceptEntryCreate], Field(max_length=MAX_IMPORT_ENTRIES)],
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> list[InterceptEntryOut]:
    """All-or-nothing bulk entry creation — the entry point a future import
    flow will call once the source format is known. Every row is validated
    by InterceptEntryCreate the same way a single POST is (FastAPI rejects
    the whole request with 422 if any row is invalid, before this body runs).
    """
    intercept = _get_writable_intercept(db, intercept_id)
    entries = [InterceptEntry(intercept_id=intercept_id, **item.model_dump()) for item in payload]
    db.add_all(entries)
    db.flush()
    _record_entries_added(db, user, intercept, entries, "import")
    db.commit()
    for entry in entries:
        db.refresh(entry)
    return _attach_derived_mode_ids(db, entries)


@router.put(
    "/{intercept_id}/entries/{entry_id}", response_model=InterceptEntryOut, dependencies=[Depends(verify_csrf)]
)
def replace_intercept_entry(
    intercept_id: UUID,
    entry_id: UUID,
    payload: InterceptEntryCreate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> InterceptEntryOut:
    """Corrects an entry in place — the whole entry is sent again and
    validated like a new one, so a switch between fixed and stagger can't
    leave the other type's fields behind. Keeps the entry's id, and with it
    the link to any Mode created from it."""
    intercept = _get_writable_intercept(db, intercept_id)
    entry = db.get(InterceptEntry, entry_id)
    if entry is None or entry.intercept_id != intercept_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found")
    # Where an imported entry came from isn't part of correcting its values:
    # kept unless the request sets it.
    values = payload.model_dump()
    for field in PROVENANCE_FIELDS:
        if field not in payload.model_fields_set:
            values.pop(field)
    changes = apply_and_diff(entry, values)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.intercept_entry.value,
        entity_id=entry.id,
        summary=f"Updated an entry on Intercept '{intercept.name}'",
        changes=changes,
        emitter_id=intercept.emitter_id,
    )
    db.commit()
    db.refresh(entry)
    return _attach_derived_mode_ids(db, [entry])[0]


@router.delete(
    "/{intercept_id}/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)]
)
def delete_intercept_entry(
    intercept_id: UUID,
    entry_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> None:
    intercept = _get_writable_intercept(db, intercept_id)
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
        changes=snapshot(entry, ENTRY_SNAPSHOT_FIELDS),
        emitter_id=intercept.emitter_id,
    )
    # Its reports stay, in no entry (ON DELETE SET NULL) — they can be regrouped.
    db.delete(entry)
    intercept.grouping_version += 1
    db.commit()


def _entries_of(db: Session, intercept_id: UUID, entry_ids: list[UUID]) -> list[InterceptEntry]:
    """The requested entries, in the order they were created — 404 if any of
    them isn't on this Intercept, so nothing is half-done."""
    wanted = set(entry_ids)
    entries = (
        db.query(InterceptEntry)
        .filter(InterceptEntry.intercept_id == intercept_id, InterceptEntry.id.in_(wanted))
        .order_by(InterceptEntry.created_at, InterceptEntry.id)
        .all()
    )
    if len(entries) != len(wanted):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Some of those entries aren't on this Intercept")
    return entries


@router.post(
    "/{intercept_id}/entries/delete", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)]
)
def delete_intercept_entries(
    intercept_id: UUID,
    payload: EntryIds,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> None:
    """Deletes several entries at once, all or nothing, with one audit row
    keeping a snapshot of each."""
    intercept = _get_writable_intercept(db, intercept_id)
    entries = _entries_of(db, intercept_id, payload.entry_ids)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.intercept.value,
        entity_id=intercept.id,
        summary=f"Deleted {len(entries)} entr{'y' if len(entries) == 1 else 'ies'} from Intercept '{intercept.name}'",
        changes={"entries": [{"id": str(e.id), **snapshot(e, ENTRY_SNAPSHOT_FIELDS)} for e in entries]},
        emitter_id=intercept.emitter_id,
    )
    for entry in entries:
        db.delete(entry)
    intercept.grouping_version += 1
    db.commit()


def _num(v) -> float | None:
    return None if v is None else float(v)


def _weighted_mean(pairs: list[tuple[float | None, int]]) -> float | None:
    known = [(v, w) for v, w in pairs if v is not None]
    if not known:
        return None
    return round(sum(v * w for v, w in known) / sum(w for _, w in known), 4)


def _span(entries: list[InterceptEntry], lo: str, hi: str, mean: str) -> tuple[float | None, float | None]:
    """The widest range across entries — each one's measured min/max, or its
    mean where it has none."""
    lows = [_num(getattr(e, lo)) if getattr(e, lo) is not None else _num(getattr(e, mean)) for e in entries]
    highs = [_num(getattr(e, hi)) if getattr(e, hi) is not None else _num(getattr(e, mean)) for e in entries]
    lows = [v for v in lows if v is not None]
    highs = [v for v in highs if v is not None]
    return (min(lows) if lows else None, max(highs) if highs else None)


@router.post(
    "/{intercept_id}/entries/merge", response_model=InterceptEntryOut, dependencies=[Depends(verify_csrf)]
)
def merge_intercept_entries(
    intercept_id: UUID,
    payload: EntryIds,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> InterceptEntryOut:
    """Merges entries that turned out to be one signal into the first of them
    (so it keeps its id and Mode links; the others' links move to it).

    Means are weighted by how many reports each entry was built from (1 when
    unknown); the measured range is the widest across them; first/last seen,
    report count and tracks combine. All must share a PRI type, and staggers
    a number of positions — an entry has one."""
    intercept = _get_writable_intercept(db, intercept_id)
    if len(set(payload.entry_ids)) < 2:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Choose at least two entries to merge")
    entries = _entries_of(db, intercept_id, payload.entry_ids)
    if len({e.pri_type for e in entries}) > 1:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "These entries have different PRI types")
    positions = {len(e.stagger_values or []) for e in entries}
    if entries[0].pri_type == PriType.stagger and len(positions) > 1:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "These staggers have different numbers of positions"
        )

    keep, others = entries[0], entries[1:]
    before = [{"id": str(e.id), **snapshot(e, ENTRY_SNAPSHOT_FIELDS)} for e in entries]
    weights = [e.report_count or 1 for e in entries]
    w = lambda field: _weighted_mean([(_num(getattr(e, field)), wt) for e, wt in zip(entries, weights)])  # noqa: E731

    # Everything is worked out from the entries as they are before any is
    # written — the kept entry is one of them.
    values: dict = {
        "rf_mean_mhz": w("rf_mean_mhz"),
        **dict(zip(("rf_min_mhz", "rf_max_mhz"), _span(entries, "rf_min_mhz", "rf_max_mhz", "rf_mean_mhz"))),
    }
    if keep.pri_type != PriType.cw:
        values["pri_mean_us"] = w("pri_mean_us")
        values["pri_min_us"], values["pri_max_us"] = _span(entries, "pri_min_us", "pri_max_us", "pri_mean_us")
        values["pw_mean_us"] = w("pw_mean_us")
        values["pw_min_us"], values["pw_max_us"] = _span(entries, "pw_min_us", "pw_max_us", "pw_mean_us")
    if keep.pri_type == PriType.fixed:
        values["jitter_mean_us"] = w("jitter_mean_us")
    if keep.pri_type == PriType.stagger:
        count = len(keep.stagger_values or [])
        values["stagger_values"] = [
            _weighted_mean([(_num(e.stagger_values[i]), wt) for e, wt in zip(entries, weights)]) for i in range(count)
        ]
    for field, value in values.items():
        setattr(keep, field, value)
    firsts = [e.first_seen_at for e in entries if e.first_seen_at]
    lasts = [e.last_seen_at for e in entries if e.last_seen_at]
    keep.first_seen_at = min(firsts) if firsts else None
    keep.last_seen_at = max(lasts) if lasts else None
    keep.report_count = sum(e.report_count for e in entries) if all(e.report_count for e in entries) else None
    tracks = sorted({t for e in entries for t in (e.tracks or [])})
    keep.tracks = tracks or None
    files = {e.source_file for e in entries}
    keep.source_file = files.pop() if len(files) == 1 else None
    notes = list(dict.fromkeys(n.strip() for n in (e.notes for e in entries) if n and n.strip()))
    keep.notes = "\n".join([f"Merged from {len(entries)} entries."] + notes)

    # The others' reports, and their links to Modes created from them, move to the kept entry.
    db.execute(
        update(InterceptReport)
        .where(InterceptReport.entry_id.in_([o.id for o in others]))
        .values(entry_id=keep.id)
    )
    intercept.grouping_version += 1
    linked = {link.mode_id for link in keep.modes}
    for other in others:
        for link in list(other.modes):
            if link.mode_id not in linked:
                db.add(InterceptEntryMode(intercept_entry_id=keep.id, mode_id=link.mode_id))
                linked.add(link.mode_id)
        db.delete(other)

    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.intercept.value,
        entity_id=intercept.id,
        summary=f"Merged {len(entries)} entries on Intercept '{intercept.name}'",
        changes={"kept_entry_id": str(keep.id), "merged": before},
        emitter_id=intercept.emitter_id,
    )
    db.commit()
    db.refresh(keep)
    return _attach_derived_mode_ids(db, [keep])[0]


ReportSort = Literal["line", "time", "rf", "pri", "pw", "track", "power"]
_REPORT_SORT = {
    "line": (InterceptReport.source_file, InterceptReport.file_line),
    "time": (InterceptReport.mission_time,),
    "rf": (InterceptReport.rf_mhz,),
    "pri": (InterceptReport.pri_us,),
    "pw": (InterceptReport.pw_us,),
    "track": (InterceptReport.track,),
    "power": (InterceptReport.power,),
}


@router.get("/{intercept_id}/reports", response_model=InterceptReportPage)
def list_intercept_reports(
    intercept_id: UUID,
    entry_id: str | None = Query(default=None, description='An entry\'s id, or "none" for reports in no entry'),
    sort: ReportSort = "line",
    direction: Literal["asc", "desc"] = "asc",
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> InterceptReportPage:
    """A page of an Intercept's reports — all of them, one entry's, or those
    in no entry — for viewing in a table."""
    _get_intercept_or_404(db, intercept_id)
    query = db.query(InterceptReport).filter(InterceptReport.intercept_id == intercept_id)
    if entry_id == "none":
        query = query.filter(InterceptReport.entry_id.is_(None))
    elif entry_id:
        try:
            query = query.filter(InterceptReport.entry_id == UUID(entry_id))
        except ValueError:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "entry_id must be an id or \"none\"")
    total = query.count()
    columns = _REPORT_SORT[sort]
    order = [(c.desc() if direction == "desc" else c.asc()).nulls_last() for c in columns]
    items = (
        query.order_by(*order, InterceptReport.source_file, InterceptReport.file_line, InterceptReport.id)
        .offset(offset)
        .limit(limit)
        .all()
    )
    return InterceptReportPage(total=total, items=[InterceptReportOut.model_validate(r) for r in items])


def _plain(v):
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, list):
        return [_plain(x) for x in v]
    if hasattr(v, "isoformat"):
        return v.isoformat()
    if hasattr(v, "value"):
        return v.value
    if isinstance(v, UUID):
        return str(v)
    return v


@router.get("/{intercept_id}/reports/all")
def all_intercept_reports(
    intercept_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> Response:
    """Every report of an Intercept at once, compactly, for regrouping:
    {grouping_version, entries: [entry ids], fields: [...], reports: [[id,
    entry index or null, ...fields]]}. Built by hand rather than through a
    response model — validating tens of thousands of rows that way is slow."""
    intercept = _get_intercept_or_404(db, intercept_id)
    fields = ("source_file",) + REPORT_ROW_FIELDS
    rows = db.execute(
        select(InterceptReport.id, InterceptReport.entry_id, *[getattr(InterceptReport, f) for f in fields])
        .where(InterceptReport.intercept_id == intercept_id)
        .order_by(InterceptReport.source_file, InterceptReport.file_line, InterceptReport.id)
    ).all()
    entry_index: dict[UUID, int] = {}
    out_rows = []
    for row in rows:
        rid, eid, *values = row
        index = None
        if eid is not None:
            index = entry_index.setdefault(eid, len(entry_index))
        out_rows.append([str(rid), index, *[_plain(v) for v in values]])
    body = {
        "grouping_version": intercept.grouping_version,
        "entries": [str(e) for e in entry_index],
        "fields": list(fields),
        "reports": out_rows,
    }
    return Response(content=json.dumps(body, separators=(",", ":")), media_type="application/json")


@router.put("/{intercept_id}/grouping", response_model=RegroupResult, dependencies=[Depends(verify_csrf)])
def regroup_intercept(
    intercept_id: UUID,
    payload: RegroupRequest,
    dry_run: bool = False,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> RegroupResult:
    """Replaces how an Intercept's reports are grouped into entries.

    Each new group keeps the id — and so the Mode links — of the old entry
    it shares the most reports with (largest overlaps first, each old entry
    used once); other groups become new entries. An old entry no group took
    is removed, its Mode links moving to the new entry that took most of its
    reports. Entries without reports (typed in by hand) aren't touched. With
    dry_run, says what would happen and changes nothing."""
    intercept = _get_writable_intercept(db, intercept_id)
    if payload.expected_version != intercept.grouping_version:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This Intercept's grouping changed since you opened it (another regroup, merge or delete). "
            "Reload to start from the current grouping.",
        )
    current = dict(
        db.execute(
            select(InterceptReport.id, InterceptReport.entry_id).where(InterceptReport.intercept_id == intercept_id)
        ).all()
    )
    seen: set[UUID] = set()
    for group in payload.groups:
        for rid in group.report_ids:
            if rid not in current:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A report in the grouping isn't on this Intercept")
            if rid in seen:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A report is in two groups")
            seen.add(rid)

    old_members: dict[UUID, set[UUID]] = {}
    for rid, eid in current.items():
        if eid is not None:
            old_members.setdefault(eid, set()).add(rid)

    # Largest overlaps first: each group keeps the old entry it most resembles.
    pairs = []
    for gi, group in enumerate(payload.groups):
        counts = Counter(current[r] for r in group.report_ids if current[r] is not None)
        pairs.extend((n, gi, eid) for eid, n in counts.items())
    pairs.sort(key=lambda p: (-p[0], p[1], str(p[2])))
    kept_by_group: dict[int, UUID] = {}
    claimed: set[UUID] = set()
    for _n, gi, eid in pairs:
        if gi not in kept_by_group and eid not in claimed:
            kept_by_group[gi] = eid
            claimed.add(eid)

    unchanged = sum(
        1 for gi, eid in kept_by_group.items() if set(payload.groups[gi].report_ids) == old_members[eid]
    )
    removed = [eid for eid in old_members if eid not in claimed]
    entries_by_id = {
        e.id: e
        for e in db.query(InterceptEntry).filter(InterceptEntry.id.in_(list(old_members))).all()
    } if old_members else {}

    # Where each removed entry's reports went — its Mode links follow the most.
    new_entry_of_group: dict[int, InterceptEntry] = {}
    moved = dropped = 0
    removed_snapshots = []
    group_of_report = {rid: gi for gi, g in enumerate(payload.groups) for rid in g.report_ids}

    for gi, group in enumerate(payload.groups):
        values = group.entry.model_dump()
        if gi in kept_by_group:
            entry = entries_by_id[kept_by_group[gi]]
            for field, value in values.items():
                setattr(entry, field, value)
        else:
            entry = InterceptEntry(intercept_id=intercept.id, **values)
            db.add(entry)
        new_entry_of_group[gi] = entry
    db.flush()

    # Every Mode link of the old entries, in one query — there can be thousands of entries.
    links_of: dict[UUID, set[UUID]] = {}
    if old_members:
        for entry_id, mode_id in db.query(InterceptEntryMode.intercept_entry_id, InterceptEntryMode.mode_id).filter(
            InterceptEntryMode.intercept_entry_id.in_(list(old_members))
        ):
            links_of.setdefault(entry_id, set()).add(mode_id)
    for eid in removed:
        old = entries_by_id[eid]
        removed_snapshots.append({"id": str(eid), **snapshot(old, ENTRY_SNAPSHOT_FIELDS)})
        targets = Counter(group_of_report[r] for r in old_members[eid] if r in group_of_report)
        links = links_of.get(eid, set())
        if targets and links:
            target = new_entry_of_group[targets.most_common(1)[0][0]]
            have = links_of.setdefault(target.id, set())
            for mode_id in links:
                if mode_id not in have:
                    db.add(InterceptEntryMode(intercept_entry_id=target.id, mode_id=mode_id))
                    have.add(mode_id)
                moved += 1
        elif links:
            dropped += len(links)

    result = RegroupResult(
        unchanged=unchanged,
        changed=len(kept_by_group) - unchanged,
        created=len(payload.groups) - len(kept_by_group),
        removed=len(removed),
        mode_links_moved=moved,
        mode_links_dropped=dropped,
        reports_left_out=len(current) - len(seen),
        grouping_version=intercept.grouping_version + 1,
    )
    if dry_run:
        db.rollback()
        result.grouping_version = intercept.grouping_version
        return result

    # Only reports whose entry changes are written — one statement for all of them.
    changes = [
        (rid, new_entry_of_group[group_of_report[rid]].id if rid in group_of_report else None)
        for rid in current
    ]
    changes = [(rid, eid) for rid, eid in changes if eid != current[rid]]
    if changes:
        db.execute(
            text(
                "UPDATE intercept_reports AS r SET entry_id = v.entry_id "
                "FROM unnest(:ids, :entry_ids) AS v(id, entry_id) WHERE r.id = v.id"
            ).bindparams(
                bindparam("ids", type_=ARRAY(PG_UUID(as_uuid=True))),
                bindparam("entry_ids", type_=ARRAY(PG_UUID(as_uuid=True))),
            ),
            {"ids": [c[0] for c in changes], "entry_ids": [c[1] for c in changes]},
        )
    # In one statement — the database drops their remaining Mode links (ON
    # DELETE CASCADE); a regroup can remove thousands.
    if removed:
        db.query(InterceptEntry).filter(InterceptEntry.id.in_(removed)).delete(synchronize_session=False)
    intercept.grouping_version += 1
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.intercept.value,
        entity_id=intercept.id,
        summary=(
            f"Regrouped {len(current)} reports on Intercept '{intercept.name}': "
            f"{result.unchanged} entries unchanged, {result.changed} changed, {result.created} new, "
            f"{result.removed} removed"
        ),
        changes={**result.model_dump(), "removed_entries": removed_snapshots},
        emitter_id=intercept.emitter_id,
    )
    db.commit()
    return result
