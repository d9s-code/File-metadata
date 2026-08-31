from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_role
from app.models.emitter import Emitter
from app.schemas.import_batch import ImportCommitResult, ImportPayload, ImportValidationResult
from app.services.audit_service import record_audit
from app.services.import_service import commit_import_payload, validate_import_payload

router = APIRouter(prefix="/emitters/{emitter_id}/imports", tags=["imports"])


def _get_emitter_or_404(db: Session, emitter_id: UUID) -> Emitter:
    emitter = db.get(Emitter, emitter_id)
    if emitter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    return emitter


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
    "", response_model=ImportCommitResult, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)]
)
def commit_import(
    emitter_id: UUID,
    payload: ImportPayload,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> ImportCommitResult:
    _get_emitter_or_404(db, emitter_id)

    # Never trust a client's earlier /validate call — re-check right before
    # persisting, in case the DB state changed since (e.g. a duplicate
    # source_name introduced by another import in between).
    result = validate_import_payload(db, emitter_id=emitter_id, payload=payload)
    if not result.valid:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=[issue.model_dump() for issue in result.issues])

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
