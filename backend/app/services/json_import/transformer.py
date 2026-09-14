from datetime import datetime, date
from typing import Any, Dict, List

from app.schemas.import_batch import ImportPayload, ParametricSetImport
from app.schemas.mode_element import ModeElementCreate, ElementType
from app.schemas.parameter_sequence import ParameterSequenceCreate, ParameterSequenceStepIn
from app.core.enums import ElementType as CoreElementType


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
    date_str = first_file.get("date_last_updated", "").split(" ")[0]
    try:
        parsed_date = datetime.strptime(date_str, "%d-%m-%Y").date()
    except ValueError:
        parsed_date = date.today()

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

                for step in steps_to_process:
                    if not isinstance(step, dict):
                        continue
                    step_data = {"order": int(step.get("step-num", 0))}
                    
                    # Handle PRI
                    if "pri-value" in step:
                        pv = step["pri-value"]
                        if "min" in pv and "max" in pv:
                            v_min = float(pv["min"])
                            v_max = float(pv["max"])
                            if abs(v_min - v_max) < 0.001:
                                step_data["pri_us"] = v_min
                            else:
                                step_data["pri_us"] = (v_min + v_max) / 2
                    
                    # Support for other potential sequence step params if present
                    if "rf-value" in step:
                        pv = step["rf-value"]
                        if "min" in pv and "max" in pv:
                            step_data["rf_mhz"] = (float(pv["min"]) + float(pv["max"])) / 2
                    
                    if "pw-value" in step or "pd-value" in step:
                        pv = step.get("pw-value") or step.get("pd-value")
                        if pv and "min" in pv and "max" in pv:
                            step_data["pw_us"] = (float(pv["min"]) + float(pv["max"])) / 2

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

        parametric_sets.append(ParametricSetImport(
            source_name=pset_json.get("set_id"),
            source_description=source_description,
            source_date=parsed_date,
            elements=elements,
            sequences=sequences
        ))

    return ImportPayload(
        document_name=first_file.get("file"),
        document_reference=first_file.get("notation"),
        parametric_sets=parametric_sets
    )
