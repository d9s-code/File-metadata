"""Snapshot builders — one per versioned entity type. Each returns a plain,
JSON-serializable dict (no Decimal/UUID/datetime objects) suitable for
storing in a `snapshot JSONB` column and for structured diffing.
"""

from app.models.emitter import Emitter
from app.models.mode import Mode, ModeElement
from app.models.platform import Platform


def _num(value):
    return float(value) if value is not None else None


def _num_list(values):
    return [float(v) for v in values] if values else None


def _mode_element_dict(element: ModeElement) -> dict:
    return {
        "id": str(element.id),
        "element_type": element.element_type.value,
        "value_min": _num(element.value_min),
        "value_max": _num(element.value_max),
        "stagger_values": _num_list(element.stagger_values),
        "jitter_min": _num(element.jitter_min),
        "jitter_max": _num(element.jitter_max),
        "label": element.label,
        "sort_order": element.sort_order,
    }


def _mode_dict(mode: Mode) -> dict:
    line = mode.line
    return {
        "id": str(mode.id),
        "name": mode.name,
        "pri_type": mode.pri_type.value,
        "notes": mode.notes,
        "sort_order": mode.sort_order,
        "source_id": str(mode.source_id),
        "line": None
        if line is None
        else {
            "rf_min_mhz": _num(line.rf_min_mhz),
            "rf_max_mhz": _num(line.rf_max_mhz),
            "pw_min_us": _num(line.pw_min_us),
            "pw_max_us": _num(line.pw_max_us),
            "pri_min_us": _num(line.pri_min_us),
            "pri_max_us": _num(line.pri_max_us),
            "jitter_min_us": _num(line.jitter_min_us),
            "jitter_max_us": _num(line.jitter_max_us),
            "pri_stagger_values_us": _num_list(line.pri_stagger_values_us),
            "type_data": line.type_data,
            "dsl_text": line.dsl_text,
        },
    }


def build_emitter_snapshot(emitter: Emitter) -> dict:
    return {
        "id": str(emitter.id),
        "name": emitter.name,
        "designation": emitter.designation,
        "description": emitter.description,
        "status": emitter.status.value,
        "ew_groups": [
            {
                "id": str(g.id),
                "name": g.name,
                "scan_min": _num(g.scan_min),
                "scan_max": _num(g.scan_max),
                "threat_priority": g.threat_priority,
                "sort_order": g.sort_order,
                "modes": [_mode_dict(m) for m in sorted(g.modes, key=lambda m: m.sort_order)],
            }
            for g in sorted(emitter.ew_groups, key=lambda g: g.sort_order)
        ],
        "sources": [
            {
                "id": str(s.id),
                "name": s.name,
                "description": s.description,
                "source_date": s.source_date.isoformat(),
                "elements": [_mode_element_dict(e) for e in sorted(s.elements, key=lambda e: e.sort_order)],
            }
            for s in sorted(emitter.sources, key=lambda s: s.name)
        ],
    }


def build_platform_snapshot(platform: Platform) -> dict:
    return {
        "id": str(platform.id),
        "name": platform.name,
        "description": platform.description,
        "links": [
            {
                "emitter_id": str(link.emitter_id),
                "emitter_name": link.emitter.name,
                "emitter_version_id": str(link.emitter_version_id),
                "emitter_version_number": link.emitter_version.version_number,
                "emitter_snapshot": link.emitter_version.snapshot,
            }
            for link in sorted(platform.links, key=lambda link: link.emitter.name)
        ],
    }
