import json
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.config import settings
from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role, SourceStatus
from app.database import get_db
from app.deps import require_emitter_checkout, require_role
from app.models.emitter import Emitter
from app.models.source import Source
from app.models.source_group import SourceGroup
from app.schemas.import_batch import ImportCommitResult, ImportPayload, ImportValidationResult
from app.schemas.prs_import import PrsImportResultOut
from app.services.audit_service import record_audit
from app.services.import_service import commit_import_payload, validate_import_payload
from app.services.json_import.transformer import transform_json_to_payload
from app.services.prs_import.prs_import_service import PrsXmlParseError, parse_emitter_xml, plan_import
from app.services.prs_import.prs_import_service import commit_import as commit_prs_import_plan

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
            status=SourceStatus.pending_review,
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
