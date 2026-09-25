from datetime import datetime, date
from typing import Any, Dict, List

from app.schemas.import_batch import ImportPayload, ParametricSetImport
from app.schemas.mode_element import ModeElementCreate, ElementType
from app.schemas.parameter_sequence import ParameterSequenceCreate, ParameterSequenceStepIn
from app.core.enums import ElementType as CoreElementType


def _parse_date_last_updated(raw: str | None) -> date | None:
    """Parses "10-06-2015 17:19:28 GMT" -> date(2015, 6, 10). Returns None
    (rather than silently defaulting to today) when the value is missing or
    malformed, so the caller can decide the right fallback."""
    if not raw:
        return None
    date_str = raw.split(" ")[0]
    try:
        return datetime.strptime(date_str, "%d-%m-%Y").date()
    except ValueError:
        return None


# JSON step key(s) -> (single-value field, range min field, range max field).
_STEP_JSON_KEYS: dict[str, tuple[str, str, str]] = {
    "pri-value": ("pri_us", "pri_min_us", "pri_max_us"),
    "rf-value": ("rf_mhz", "rf_min_mhz", "rf_max_mhz"),
    "pw-value": ("pw_us", "pw_min_us", "pw_max_us"),
}


def _json_range(step: dict, key: str) -> tuple[float, float] | None:
    """A step's {"min", "max"} for one parameter, as floats. PW may come in
    as "pd-value" (pulse duration)."""
    value = step.get(key)
    if value is None and key == "pw-value":
        value = step.get("pd-value")
    if not isinstance(value, dict) or "min" not in value or "max" not in value:
        return None
    return float(value["min"]), float(value["max"])


def transform_json_to_payload(
    json_data: List[Dict[str, Any]], *, override_source_date: date | None = None
) -> ImportPayload:
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

    "date_last_updated" lives on each parametric set, not on the file as a
    whole — read per-set below, not once for the whole file. If a set has no
    parseable date of its own, `override_source_date` (typed in manually at
    import time) is used; failing that, today's date is the last resort.
    """
    if not json_data:
        raise ValueError("JSON data is empty")

    # We take the first file in the list as the document
    first_file = json_data[0]

    parametric_sets = []
    
    for pset_json in first_file.get("parametric_sets", []):
        elements = []
        sequences = []
        source_description = pset_json.get("signal-type")
        
        for group in pset_json.get("groups", []):
            if group.get("type") == "sequence":
                # Map to ParameterSequenceCreate
                steps = []
                raw_steps = group.get("steps", [])
                # JSON format can provide steps as a single object or a list of objects
                if isinstance(raw_steps, dict):
                    steps_to_process = [raw_steps]
                elif isinstance(raw_steps, list):
                    steps_to_process = raw_steps
                else:
                    steps_to_process = []

                steps_to_process = [step for step in steps_to_process if isinstance(step, dict)]
                # A sequence that steps through more than one parameter type
                # (e.g. RF and PRI together) keeps each step's min/max; a
                # single-parameter one keeps one value per step.
                present = {key for step in steps_to_process for key in _STEP_JSON_KEYS if _json_range(step, key)}
                keep_ranges = len(present) > 1

                for step in steps_to_process:
                    step_data: dict[str, Any] = {"order": int(step.get("step-num", 0))}
                    for key, (point_field, min_field, max_field) in _STEP_JSON_KEYS.items():
                        rng = _json_range(step, key)
                        if rng is None:
                            continue
                        v_min, v_max = rng
                        if abs(v_min - v_max) < 0.001:
                            step_data[point_field] = v_min
                        elif keep_ranges:
                            step_data[min_field] = v_min
                            step_data[max_field] = v_max
                        else:
                            step_data[point_field] = (v_min + v_max) / 2

                    steps.append(ParameterSequenceStepIn(**step_data))

                sequences.append(ParameterSequenceCreate(
                    label=group.get("name"),
                    steps=steps,
                    sort_order=group.get("index", 0)
                ))

            elif group.get("type") == "independent":
                kind = group.get("kind")
                values = group.get("values", [])
                
                target_type = None
                if kind == "rf": target_type = ElementType.rf
                elif kind == "pri": target_type = ElementType.pri
                elif kind == "pw_pd": target_type = ElementType.pw
                
                if target_type:
                    for val_obj in values:
                        sub_kind = val_obj.get("sub_kind")
                        val = val_obj.get("value")
                        
                        if not val: continue

                        if sub_kind in ["rf-legacy-term", "pri-legacy-term"]:
                            if not source_description or source_description == pset_json.get("signal-type"):
                                source_description = str(val)
                            continue

                        if sub_kind in ["prf-typical", "prf-most-prob-values", "prf-extreme"]:
                            continue

                        # Override target type if sub_kind implies a different element type
                        # e.g. scan-primary-typical -> scan
                        effective_target_type = target_type
                        if "scan" in sub_kind:
                            effective_target_type = CoreElementType.scan

                        # Mapping subtype to variant
                        variant = "discrete"
                        if sub_kind:
                            sub_kind_lower = sub_kind.lower()
                            if any(x in sub_kind_lower for x in ["most-prob-values", "most_probable", "most-prob"]):
                                variant = "most_probable"
                            elif "extreme" in sub_kind_lower:
                                variant = "extreme"
                            elif "typical" in sub_kind_lower:
                                variant = "typical"
                            elif "discrete" in sub_kind_lower:
                                variant = "discrete"

                        if isinstance(val, dict):
                            actual_val = val
                            if "value" in val and isinstance(val["value"], dict):
                                actual_val = val["value"]
                                
                            # Case 1: The value is a list of items (like pri-values)
                            if "value" in val and isinstance(val["value"], list):
                                for item in val["value"]:
                                    item_min = float(item.get("min", 0))
                                    item_max = float(item.get("max", 0))
                                    
                                    el = ModeElementCreate(
                                        element_type=effective_target_type,
                                        value_min=item_min,
                                        value_max=item_max,
                                        variant=variant,
                                        label=sub_kind if sub_kind not in ["rf-typical", "rf-most-prob-values", "pri-typical", "pri-values", "pd-typical", "pd-most-prob-values"] else None
                                    )
                                    elements.append(el)
                            # Case 2: The value is a single range/dict
                            else:
                                v_min = float(actual_val.get("min", 0))
                                v_max = float(actual_val.get("max", 0))

                                el = ModeElementCreate(
                                    element_type=effective_target_type,
                                    value_min=v_min,
                                    value_max=v_max,
                                    variant=variant,
                                    label=sub_kind if sub_kind not in ["rf-typical", "rf-most-prob-values", "pri-typical", "pri-values", "pd-typical", "pd-most-prob-values"] else None
                                )
                                elements.append(el)
                        elif isinstance(val, (int, float, str)):
                            # This handles single value scalars if they appear
                            try:
                                v_val = float(val)
                                el = ModeElementCreate(
                                    element_type=effective_target_type,
                                    value_min=v_val,
                                    value_max=v_val,
                                    variant=variant,
                                    label=sub_kind if sub_kind not in ["rf-typical", "rf-most-prob-values", "pri-typical", "pri-values", "pd-typical", "pd-most-prob-values"] else None
                                )
                                elements.append(el)
                            except (ValueError, TypeError):
                                # Skip non-numeric values as they cannot be ModeElements
                                continue

        source_date = (
            override_source_date
            or _parse_date_last_updated(pset_json.get("date_last_updated"))
            or date.today()
        )
        parametric_sets.append(ParametricSetImport(
            source_name=pset_json.get("set_id"),
            source_description=source_description,
            source_date=source_date,
            elements=elements,
            sequences=sequences
        ))

    return ImportPayload(
        document_name=first_file.get("file"),
        document_reference=first_file.get("notation"),
        parametric_sets=parametric_sets
    )
