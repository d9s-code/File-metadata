import json
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.config import settings
from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_emitter_checkout, require_role
from app.models.emitter import Emitter
from app.models.source import Source
from app.models.source_group import SourceGroup
from app.schemas.import_batch import (
    ImportCommitResult,
    ImportPayload,
    ImportValidationResult,
)
from app.schemas.prs_import import (
    PrsFileModeOut,
    PrsImportIssueOut,
    PrsImportResultOut,
    PrsUpdatePairOut,
    PrsUpdatePreviewOut,
    PrsUpdateResultOut,
)
from app.services.audit_service import record_audit
from app.services.import_service import commit_import_payload, validate_import_payload
from app.services.json_import.transformer import transform_json_to_payload
from app.services.prs_import.prs_import_service import (
    PrsXmlParseError,
    parse_emitter_xml,
    plan_import,
)
from app.services.prs_import.prs_import_service import (
    commit_import as commit_prs_import_plan,
)
from app.services.prs_import.prs_update_service import (
    auto_pairs,
    emitter_modes,
    file_modes,
    plan_update,
    update_payload,
)

router = APIRouter(prefix="/emitters/{emitter_id}/imports", tags=["imports"])


def _get_emitter_or_404(db: Session, emitter_id: UUID) -> Emitter:
    emitter = db.get(Emitter, emitter_id)
    if emitter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    return emitter


def _read_upload(file: UploadFile) -> bytes:
    content = file.file.read(settings.max_upload_bytes + 1)
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            f"File is larger than the {settings.max_upload_bytes // (1024 * 1024)} MB upload limit",
        )
    return content


@router.post("/validate", response_model=ImportValidationResult)
def validate_import(
    emitter_id: UUID,
    payload: ImportPayload,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.editor)),
) -> ImportValidationResult:
    _get_emitter_or_404(db, emitter_id)
    return validate_import_payload(db, emitter_id=emitter_id, payload=payload)


@router.post(
    "/json-import", response_model=ImportCommitResult, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)]
)
def commit_json_import(
    emitter_id: UUID,
    file: UploadFile = File(...),
    # Manually-entered "Date last updated" — takes precedence over whatever
    # (if anything) the uploaded JSON's own per-set date_last_updated parses
    # to. Optional: leave unset to trust the file's own dates.
    source_date: date | None = Form(None),
    # An existing Source Group to file every Source this import creates
    # under. Leave unset to fall back to commit_import_payload's default: one
    # new group created automatically for this import batch.
    group_id: UUID | None = Form(None),
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> ImportCommitResult:
    try:
        json_data = json.loads(_read_upload(file))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Not a valid JSON file: {exc}") from exc
    try:
        payload = transform_json_to_payload(json_data, override_source_date=source_date)
    except (ValueError, TypeError, KeyError, IndexError, AttributeError) as exc:
        # ValueError includes pydantic's ValidationError from the payload models.
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"JSON file doesn't match the expected import format: {exc}"
        ) from exc

    if group_id is not None and db.get(SourceGroup, group_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source group not found")

    # Re-use existing logic
    result = validate_import_payload(db, emitter_id=emitter_id, payload=payload)
    if not result.valid:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=[issue.model_dump() for issue in result.issues])

    batch, sources = commit_import_payload(
        db, emitter_id=emitter_id, payload=payload, created_by=user.id, group_id=group_id
    )
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.import_batch.value,
        entity_id=batch.id,
        summary=f"Imported {len(sources)} Source(s) from JSON: '{payload.document_name}'",
        changes={
            "document_name": payload.document_name,
            "document_reference": payload.document_reference,
            "source_count": len(sources),
        },
        emitter_id=emitter_id,
    )
    db.commit()
    db.refresh(batch)
    for source in sources:
        db.refresh(source)

    return ImportCommitResult(
        import_batch=batch,
        created_source_ids=[s.id for s in sources],
        source_count=len(sources),
        element_count=sum(len(s.elements) for s in sources),
        sequence_count=sum(len(s.parameter_sequences) for s in sources),
    )


@router.post(
    "", response_model=ImportCommitResult, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)]
)
def commit_import(
    emitter_id: UUID,
    payload: ImportPayload,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> ImportCommitResult:
    _get_emitter_or_404(db, emitter_id)

    # Never trust a client's earlier /validate call — re-check right before
    # persisting, in case the DB state changed since (e.g. a duplicate
    # source_name introduced by another import in between).
    result = validate_import_payload(db, emitter_id=emitter_id, payload=payload)
    if not result.valid:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=[issue.model_dump() for issue in result.issues])

    batch, sources = commit_import_payload(db, emitter_id=emitter_id, payload=payload, created_by=user.id)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.import_batch.value,
        entity_id=batch.id,
        summary=f"Imported {len(sources)} Source(s) from '{payload.document_name}'",
        changes={
            "document_name": payload.document_name,
            "document_reference": payload.document_reference,
            "source_count": len(sources),
        },
        emitter_id=emitter_id,
    )
    db.commit()
    db.refresh(batch)
    for source in sources:
        db.refresh(source)

    return ImportCommitResult(
        import_batch=batch,
        created_source_ids=[s.id for s in sources],
        source_count=len(sources),
        element_count=sum(len(s.elements) for s in sources),
        sequence_count=sum(len(s.parameter_sequences) for s in sources),
    )


@router.post(
    "/prs-import",
    response_model=PrsImportResultOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def commit_prs_import(
    emitter_id: UUID,
    file: UploadFile = File(...),
    # Exactly one of these: attach every imported Mode to an existing
    # Source, or create a new one to hold them. Modes require a Source and
    # the PRS format has no concept of one, so this is always the caller's
    # call, never inferred.
    source_id: UUID | None = Form(None),
    new_source_name: str | None = Form(None),
    source_date: date | None = Form(None),
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> PrsImportResultOut:
    _get_emitter_or_404(db, emitter_id)

    if (source_id is None) == (not new_source_name):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Provide exactly one of source_id (an existing Source) or new_source_name (create one)",
        )

    try:
        parsed = parse_emitter_xml(_read_upload(file))
    except PrsXmlParseError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc))

    # Validate before touching the DB at all — same all-or-nothing ordering
    # as the JSON importer's validate-then-commit, so a bad file never
    # leaves a stray new Source behind with nothing imported into it.
    planned, issues = plan_import(parsed)
    if issues:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail=[{"mode_name": i.mode_name, "error": i.error} for i in issues]
        )
    if not planned:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "No Modes found in this file")

    if source_id is not None:
        source = db.get(Source, source_id)
        if source is None or source.emitter_id != emitter_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found in this Emitter")
    else:
        source = Source(
            emitter_id=emitter_id,
            name=new_source_name,
            source_date=source_date or date.today(),
        )
        db.add(source)
        db.flush()

    result = commit_prs_import_plan(db, emitter_id=emitter_id, parsed=parsed, planned=planned, source_id=source.id)

    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.prs_import.value,
        entity_id=source.id,
        summary=(
            f"Imported {len(result.created_mode_ids)} Mode(s) from PRS XML '{parsed.emitter_name}'"
            + (f", created {len(result.created_ew_group_names)} EW Group(s)" if result.created_ew_group_names else "")
        ),
        changes={
            "source_id": str(source.id),
            "source_name": source.name,
            "ew_groups_created": result.created_ew_group_names,
            "mode_count": len(result.created_mode_ids),
        },
        emitter_id=emitter_id,
    )
    db.commit()

    return PrsImportResultOut(
        source_id=source.id,
        ew_group_count=len(result.created_ew_group_names),
        created_ew_group_names=result.created_ew_group_names,
        mode_count=len(result.created_mode_ids),
        created_mode_ids=result.created_mode_ids,
    )


def _prs_update_plan(db: Session, emitter_id: UUID, file: UploadFile, mode_ids: str, pairs: str | None, keep_deltas: bool):
    """Parses the file and pairs the Modes picked with its Modes — by name,
    unless `pairs` (JSON: Mode id -> index into the file's Modes, or null)
    says otherwise. Shared by the preview and the update itself."""
    _get_emitter_or_404(db, emitter_id)
    try:
        wanted = [UUID(x) for x in json.loads(mode_ids)]
        chosen_raw = json.loads(pairs) if pairs else None
    except (ValueError, TypeError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "mode_ids and pairs must be JSON")
    if not wanted:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Pick the Modes to update")
    try:
        parsed = parse_emitter_xml(_read_upload(file))
    except PrsXmlParseError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc))
    planned, issues = plan_import(parsed)
    if not planned:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "No usable Modes found in this file")

    by_id = {m.id: m for m in emitter_modes(db, emitter_id)}
    missing = [i for i in wanted if i not in by_id]
    if missing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "A Mode picked isn't in this Emitter")
    modes = [by_id[i] for i in dict.fromkeys(wanted)]
    auto = auto_pairs(modes, planned)
    if chosen_raw is None:
        chosen = auto
    else:
        try:
            chosen = {UUID(k): (None if v is None else int(v)) for k, v in chosen_raw.items()}
        except (ValueError, TypeError):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "pairs must map Mode ids to a Mode's index in the file")
        chosen = {m.id: chosen.get(m.id) for m in modes}
        used = [i for i in chosen.values() if i is not None]
        if any(i < 0 or i >= len(planned) for i in used):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A pair names a Mode that isn't in the file")
        if len(used) != len(set(used)):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Each Mode in the file can update one Mode only")
    plan = plan_update(modes, planned, chosen, keep_deltas, auto)
    return parsed, planned, issues, plan


@router.post("/prs-update/preview", response_model=PrsUpdatePreviewOut, dependencies=[Depends(verify_csrf)])
def preview_prs_update(
    emitter_id: UUID,
    file: UploadFile = File(...),
    mode_ids: str = Form(...),
    pairs: str | None = Form(None),
    keep_deltas: bool = Form(True),
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.editor)),
) -> PrsUpdatePreviewOut:
    """What updating the Modes picked from this file would change — nothing is saved."""
    parsed, planned, issues, plan = _prs_update_plan(db, emitter_id, file, mode_ids, pairs, keep_deltas)
    out = PrsUpdatePreviewOut(
        file_emitter_name=parsed.emitter_name,
        file_modes=[PrsFileModeOut(**f) for f in file_modes(parsed, planned)],
        issues=[PrsImportIssueOut(mode_name=i.mode_name, error=i.error) for i in issues],
        pairs=[
            PrsUpdatePairOut(
                mode_id=p.mode.id,
                mode_name=p.mode.name,
                ew_group_name=p.mode.ew_group.name,
                file_index=p.index,
                match=p.match,
                changes=p.changes,
                notes=p.notes,
                error=p.error,
            )
            for p in plan
        ],
    )
    db.rollback()
    return out


@router.post("/prs-update", response_model=PrsUpdateResultOut, dependencies=[Depends(verify_csrf)])
def commit_prs_update(
    emitter_id: UUID,
    file: UploadFile = File(...),
    mode_ids: str = Form(...),
    pairs: str | None = Form(None),
    keep_deltas: bool = Form(True),
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> PrsUpdateResultOut:
    """Updates each Mode picked in place from its counterpart in the file —
    all of them or none. Modes without a counterpart are left as they are."""
    # Imported here: the Modes router's edit is the one a Mode's form makes,
    # checked and audited the same way.
    from app.routers.modes import update_mode_record

    parsed, planned, _issues, plan = _prs_update_plan(db, emitter_id, file, mode_ids, pairs, keep_deltas)
    bad = [p for p in plan if p.error]
    if bad:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=[{"mode_name": p.mode.name, "error": p.error} for p in bad],
        )
    origin = f" from PRS XML '{parsed.emitter_name}'"
    updated: list[str] = []
    unchanged: list[str] = []
    skipped: list[str] = []
    for p in plan:
        if p.index is None:
            skipped.append(p.mode.name)
        elif not p.changes:
            unchanged.append(p.mode.name)
        else:
            update_mode_record(db, p.mode, update_payload(p, planned), user.id, origin=origin)
            updated.append(p.mode.name)
    if updated:
        record_audit(
            db,
            actor_id=user.id,
            action=AuditAction.update,
            entity_type=AuditEntityType.prs_import.value,
            entity_id=emitter_id,
            summary=f"Updated {len(updated)} Mode(s) from PRS XML '{parsed.emitter_name}'",
            changes={
                "modes_updated": updated,
                "modes_unchanged": unchanged,
                "modes_skipped": skipped,
                "deltas_kept": keep_deltas,
            },
            emitter_id=emitter_id,
        )
    db.commit()
    return PrsUpdateResultOut(updated=updated, unchanged=unchanged, skipped=skipped)
