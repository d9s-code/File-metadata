from uuid import UUID

from sqlalchemy.orm import Session

from app.core.enums import SourceStatus
from app.models.import_batch import ImportBatch
from app.models.mode import ModeElement
from app.models.parameter_sequence import ParameterSequence
from app.models.source import Source
from app.schemas.import_batch import ImportFieldIssue, ImportPayload, ImportValidationResult


def validate_import_payload(db: Session, *, emitter_id: UUID, payload: ImportPayload) -> ImportValidationResult:
    """Read-only. Pydantic already enforced per-object shape (a payload that
    failed those checks never reaches this function) — this only covers
    cross-object checks Pydantic can't do on its own, e.g. duplicate
    source_name within the same import.
    """
    issues: list[ImportFieldIssue] = []
    seen_names: set[str] = set()
    element_count = 0
    sequence_count = 0

    for i, pset in enumerate(payload.parametric_sets):
        if pset.source_name in seen_names:
            issues.append(
                ImportFieldIssue(
                    path=f"parametric_sets[{i}].source_name",
                    message=f"Duplicate source_name '{pset.source_name}' within this import",
                )
            )
        seen_names.add(pset.source_name)
        element_count += len(pset.elements)
        sequence_count += len(pset.sequences)

    return ImportValidationResult(
        valid=not any(i.severity == "error" for i in issues),
        issues=issues,
        parametric_set_count=len(payload.parametric_sets),
        element_count=element_count,
        sequence_count=sequence_count,
    )


def commit_import_payload(
    db: Session, *, emitter_id: UUID, payload: ImportPayload, created_by: UUID
) -> tuple[ImportBatch, list[Source]]:
    """Persists the batch + every parametric set's Source/Elements/Sequences.
    Does not commit — the caller (router) owns the transaction boundary, same
    as every other create endpoint in this codebase.
    """
    batch = ImportBatch(
        emitter_id=emitter_id,
        document_name=payload.document_name,
        document_reference=payload.document_reference,
        created_by=created_by,
    )
    db.add(batch)
    db.flush()

    created_sources: list[Source] = []
    for pset in payload.parametric_sets:
        source = Source(
            emitter_id=emitter_id,
            name=pset.source_name,
            description=pset.source_description,
            source_date=pset.source_date,
            status=SourceStatus.pending_review,
            import_batch_id=batch.id,
        )
        db.add(source)
        db.flush()

        for el in pset.elements:
            db.add(ModeElement(source_id=source.id, **el.model_dump()))
        for seq in pset.sequences:
            db.add(
                ParameterSequence(
                    source_id=source.id,
                    label=seq.label,
                    variant=seq.variant,
                    steps=[step.model_dump() for step in seq.steps],
                    sort_order=seq.sort_order,
                )
            )
        created_sources.append(source)

    return batch, created_sources
