"""Snapshot builders — one per versioned entity type. Each returns a plain,
JSON-serializable dict (no Decimal/UUID/datetime objects) suitable for
storing in a `snapshot JSONB` column and for structured diffing.
"""

from app.models.emitter import Emitter
from app.models.mdf import Mdf
from app.models.mode import Mode, ModeElement
from app.models.parameter_sequence import ParameterSequence
from app.models.platform import Platform
from app.models.test_line import TestLine


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
        "variant": element.variant.value if element.variant else None,
        "delta": _num(element.delta),
        "details": element.details,
    }


def _sequence_dict(sequence: ParameterSequence) -> dict:
    return {
        "id": str(sequence.id),
        "label": sequence.label,
        "variant": sequence.variant.value if sequence.variant else None,
        "steps": sequence.steps,
        "sort_order": sequence.sort_order,
        "rf_delta": _num(sequence.rf_delta),
        "pw_delta": _num(sequence.pw_delta),
        "pri_delta": _num(sequence.pri_delta),
    }


def _mode_dict(mode: Mode) -> dict:
    line = mode.line
    return {
        "id": str(mode.id),
        "name": mode.name,
        "pri_type": mode.pri_type.value,
        "notes": mode.notes,
        "sort_order": mode.sort_order,
        "confirmation_quality": mode.confirmation_quality,
        "confirmation_quantity": mode.confirmation_quantity,
        # The first Source as before; the rest (a Mode can have several) after it.
        "source_id": str(mode.source_id),
        "source_name": mode.source.name,
        "extra_source_ids": [str(link.source_id) for link in mode.extra_source_links],
        "source_names": mode.source_names,
        "generation_batch_id": str(mode.generation_batch_id) if mode.generation_batch_id else None,
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
            "rf_delta": _num(line.rf_delta),
            "pw_delta": _num(line.pw_delta),
            "pri_delta": _num(line.pri_delta),
            "frame_time_delta_us": _num(line.frame_time_delta_us),
            "explicit_frame_time_us": _num(line.explicit_frame_time_us),
            "rf_range_matching": line.rf_range_matching,
            "pw_range_matching": line.pw_range_matching,
            "pri_range_matching": line.pri_range_matching,
            "type_data": line.type_data,
            "dsl_text": line.dsl_text,
        },
    }


def _test_line_dict(tl: TestLine) -> dict:
    return {
        "id": str(tl.id),
        "label": tl.label,
        "expected_mode_id": str(tl.expected_mode_id) if tl.expected_mode_id else None,
        "expected_mode_name": tl.expected_mode.name if tl.expected_mode else None,
        "expected_parameters": tl.expected_parameters,
        "created_date": tl.created_date.isoformat() if tl.created_date else None,
        "sort_order": tl.sort_order,
        "import_batch_label": tl.import_batch_label,
        "imported_by": str(tl.imported_by) if tl.imported_by else None,
    }


def build_emitter_snapshot(emitter: Emitter) -> dict:
    # Ties in sort_order are broken by name and id, so the same rows always
    # give the same snapshot (and export) whatever order the database reads them in.
    return {
        "id": str(emitter.id),
        "name": emitter.name,
        "designation": emitter.designation,
        "description": emitter.description,
        "status": emitter.status,
        "ew_groups": [
            {
                "id": str(g.id),
                "name": g.name,
                "scan_min": _num(g.scan_min),
                "scan_max": _num(g.scan_max),
                "scan_delta": _num(g.scan_delta),
                "threat_priority": g.threat_priority,
                "ageout": _num(g.ageout),
                "sort_order": g.sort_order,
                "modes": [_mode_dict(m) for m in sorted(g.modes, key=lambda m: (m.sort_order, m.name, str(m.id)))],
            }
            for g in sorted(emitter.ew_groups, key=lambda g: (g.sort_order, g.name, str(g.id)))
        ],
        "sources": [
            {
                "id": str(s.id),
                "name": s.name,
                "description": s.description,
                "source_date": s.source_date.isoformat(),
                "source_type": s.source_type,
                "intercept_id": str(s.intercept_id) if s.intercept_id else None,
                "rf_legacy_term": s.rf_legacy_term,
                "pri_legacy_term": s.pri_legacy_term,
                "group_id": str(s.group_id) if s.group_id else None,
                "import_batch_id": str(s.import_batch_id) if s.import_batch_id else None,
                "elements": [_mode_element_dict(e) for e in sorted(s.elements, key=lambda e: (e.sort_order, str(e.id)))],
                "parameter_sequences": [_sequence_dict(q) for q in sorted(s.parameter_sequences, key=lambda q: (q.sort_order, str(q.id)))],
            }
            for s in sorted(emitter.sources, key=lambda s: (s.name, str(s.id)))
        ],
        "test_lines": [_test_line_dict(tl) for tl in sorted(emitter.test_lines, key=lambda tl: (tl.sort_order, tl.label, str(tl.id)))],
    }


def build_platform_snapshot(platform: Platform) -> dict:
    return {
        "id": str(platform.id),
        "name": platform.name,
        "description": platform.description,
        "status": platform.status,
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


def build_mdf_snapshot(mdf: Mdf) -> dict:
    from sqlalchemy.orm import object_session

    from app.services.dwell_service import mdf_dwell_pins

    return {
        "id": str(mdf.id),
        "name": mdf.name,
        "description": mdf.description,
        "status": mdf.status,
        "links": [
            {
                "platform_id": str(link.platform_id),
                "platform_name": link.platform.name,
                "platform_version_id": str(link.platform_version_id),
                "platform_version_number": link.platform_version.version_number,
                "platform_snapshot": link.platform_version.snapshot,
            }
            for link in sorted(mdf.links, key=lambda link: link.platform.name)
        ],
        # Its dwell files, each at its latest saved version.
        "dwell_files": mdf_dwell_pins(object_session(mdf), mdf.id),
    }
