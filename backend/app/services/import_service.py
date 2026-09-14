from datetime import datetime, date
from uuid import UUID
from typing import Any, Dict, List

from sqlalchemy.orm import Session

from app.core.enums import SourceStatus
from app.models.import_batch import ImportBatch
from app.models.mode import ModeElement
from app.models.parameter_sequence import ParameterSequence
from app.models.source import Source
from app.schemas.import_batch import ImportFieldIssue, ImportPayload, ImportValidationResult
from app.schemas.mode_element import ModeElementCreate, ElementType, ElementVariant
from app.schemas.parameter_sequence import ParameterSequenceCreate, ParameterSequenceStepIn
from app.services.json_import.transformer import transform_json_to_payload


def transform_json_to_payload(json_data: List[Dict[str, Any]]) -> ImportPayload:
    """
    Transforms the JSON format into our internal ImportPayload.
    
    JSON structure (one per file):
    {
        "file": str,
        "notation": str,
        "parametric_sets": [
            {
                "set_name": str,
                "date_last_updated": str (DD-MM-YYYY HH:MM:SS GMT),
                "groups": [
                    {"type": "sequence", "name": str, "steps": [...]},
                    {"type": "independent", "kind": "rf", "values": [...]}
                ]
            }
        ]
    }
    """
    if not json_data:
        raise ValueError("JSON data is empty")
    
    # We take the first file in the list as the document
    first_file = json_data[0]
    
    # Parse date: "10-06-2015 17:19:28 GMT" -> date(2015, 6, 10)
    # Note: stripping ' GMT' if present
    date_str = first_file.get("date_last_updated", "").split(" ")[0]
    try:
        parsed_date = datetime.strptime(date_str, "%d-%m-%Y").date()
    except ValueError:
        # Fallback if format is different
        parsed_date = date.today()

    parametric_sets = []
    
    for pset_json in first_file.get("parametric_sets", []):
        elements = []
        sequences = []
        
        for group in pset_json.get("groups", []):
            if group.get("type") == "sequence":
                # Map to ParameterSequenceCreate
                steps = []
                for step in group.get("steps", []):
                    # Map JSON 'pri-value' to 'pri_us' etc.
                    # In JSON: "pri-value": {"min": "658.6", "max": "658.8"}
                    # We use the min/max or just one if they are equal. 
                    # For simplicity and compatibility with our schema, 
                    # we'll map the single value if it's a constant.
                    # Note: the JSON uses strings for numbers.
                    
                    new_step = ParameterSequenceStepIn(order=step.get("step-num", 0))
                    
                    # Handle PRI
                    if "pri-value" in step:
                        pv = step["pri-value"]
                        if "min" in pv and "max" in pv:
                            # If they are close or same, treat as constant
                            val = float(pv["min"])
                            if abs(float(pv["min"]) - float(pv["max"])) < 0.001:
                                new_step.pri_us = val
                            else:
                                # Our schema doesn't support ranges in steps, 
                                # it expects a single value per step.
                                # We'll take the average or min.
                                new_step.pri_us = (float(pv["min"]) + float(pv["max"])) / 2
                    
                    # Handle other params if they exist in step (though JSON shows them in independent groups)
                    steps.append(new_step)
                
                sequences.append(ParameterSequenceCreate(
                    label=group.get("name"),
                    steps=steps,
                    sort_order=group.get("index", 0)
                ))

            elif group.get("type") == "independent":
                kind = group.get("kind")
                values = group.get("values", [])
                
                # Find the right sub_kind for the parameter
                # rf: rf-typical, rf-most-prob-values, rf-legacy-term
                # pri: pri-typical, pri-values, pri-legacy-term, scan-primary-type
                # pw_pd: pd-typical, pd-most-prob-values
                
                target_type = None
                if kind == "rf": target_type = ElementType.rf
                elif kind == "pri": target_type = ElementType.pri
                elif kind == "pw_pd": target_type = ElementType.pw
                
                if target_type:
                    for val_obj in values:
                        sub_kind = val_obj.get("sub_kind")
                        val = val_obj.get("value")
                        
                        if not val: continue

                        # 1. Handle constant/legacy term (label)
                        if sub_kind == "rf-legacy-term":
                            pset.rf_legacy_term = val
                            continue
                        elif sub_kind == "pri-legacy-term":
                            pset.pri_legacy_term = val
                            continue

                        # 2. Handle Range/Typical values
                        if isinstance(val, dict):
                            # Case: {"min": "...", "max": "..."} or {"value": {"min": "...", "max": "..."}}
                            actual_val = val
                            if "value" in val and isinstance(val["value"], dict):
                                actual_val = val["value"]
                                
                            v_min = float(actual_val.get("min", 0))
                            v_max = float(actual_val.get("max", 0))
                            
                            # Handle "most probable" list: [{"min": "...", "max": "..."}, ...]
                            if "value" in val and isinstance(val["value"], list):
                                # Take the first one for the element
                                v_min = float(val["value"][0]["min"])
                                v_max = float(val["value"][0]["max"])

                            # Create element
                            el = ModeElementCreate(
                                element_type=target_type,
                                value_min=v_min,
                                value_max=v_max,
                                label=sub_kind if sub_kind not in ["rf-typical", "rf-most-prob-values", "pri-typical", "pri-values", "pd-typical", "pd-most-prob-values"] else None
                            )
                            elements.append(el)
                            break # Found the primary value for this kind, move to next kind

        parametric_sets.append(ParametricSetImport(
            source_name=pset_json.get("set_name"),
            source_description=pset_json.get("signal-type"),
            source_date=parsed_date,
            elements=elements,
            sequences=sequences
        ))

    return ImportPayload(
        document_name=first_file.get("file"),
        document_reference=first_file.get("notation"),
        parametric_sets=parametric_sets
    )


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
            rf_legacy_term=pset.source_description,
            pri_legacy_term=pset.pri_legacy_term,
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
