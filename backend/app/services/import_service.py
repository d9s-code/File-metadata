from uuid import UUID

from sqlalchemy.orm import Session

from app.core.enums import SourceStatus
from app.models.import_batch import ImportBatch
from app.models.mode import ModeElement
from app.models.parameter_sequence import ParameterSequence
from app.models.source import Source
from app.models.source_group import SourceGroup
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
    db: Session, *, emitter_id: UUID, payload: ImportPayload, created_by: UUID, group_id: UUID | None = None
) -> tuple[ImportBatch, list[Source]]:
    """Persists the batch + every parametric set's Source/Elements/Sequences.
    Does not commit — the caller (router) owns the transaction boundary, same
    as every other create endpoint in this codebase.

    `group_id`, if given (an existing SourceGroup the caller already resolved),
    is used for every Source this import creates instead of the default
    one-new-group-per-batch behavior below.
    """
    batch = ImportBatch(
        emitter_id=emitter_id,
        document_name=payload.document_name,
        document_reference=payload.document_reference,
        created_by=created_by,
    )
    db.add(batch)
    db.flush()

    if group_id is not None:
        target_group_id = group_id
    else:
        # One SourceGroup per import batch, so everything a single import brought
        # in stays browsable together on the Source Groups page — named after
        # the source document, deduplicated with the batch id since
        # SourceGroup.name is unique and the same file may be re-imported later.
        group_label = payload.document_name or "Import"
        group = SourceGroup(name=f"{group_label} — {batch.id.hex[:8]}")
        db.add(group)
        db.flush()
        target_group_id = group.id

    created_sources: list[Source] = []
    for pset in payload.parametric_sets:
        source = Source(
            emitter_id=emitter_id,
            name=pset.source_name,
            rf_legacy_term=pset.source_description,
            pri_legacy_term=pset.pri_legacy_term,
            source_date=pset.source_date,
            status=SourceStatus.pending_review,
            import_batch_id=batch.id,
            group_id=target_group_id,
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
