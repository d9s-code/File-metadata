"""A human-readable diff between two Emitter snapshots, purpose-built for
"what changed" views (currently: live-vs-latest-commit) — unlike the generic
path-based `app.services.diffing.compute_diff` (built for arbitrary nested
JSON, including Platform/MDF snapshots that embed full Emitter snapshots
inside them), this walks the Emitter snapshot's own known shape and matches
EW Groups/Sources/Modes/Test Lines by the id a snapshot already preserves, so
a Mode that moved position in its list is never mistaken for two different
Modes.
Every entry names the actual Mode/EW Group/Source and a human field label —
never a raw DeepDiff path like `['ew_groups'][0]['modes'][1]['line']['rf_max_mhz']`.
"""

from app.core.enums import EMITTER_STATUS_LABELS

EMITTER_FIELD_LABELS = {
    "name": "Name",
    "designation": "Designation",
    "description": "Description",
    "status": "Status",
}

EW_GROUP_FIELD_LABELS = {
    "name": "Name",
    "scan_min": "Scan Min",
    "scan_max": "Scan Max",
    "threat_priority": "Threat Priority",
    "ageout": "Ageout (s)",
}

SOURCE_FIELD_LABELS = {
    "name": "Name",
    "description": "Description",
    "source_date": "Source Date",
    "status": "Review Status",
    "rejection_reason": "Rejection Reason",
}

SOURCE_FIELDS_ADDED_LATER = frozenset({"status", "rejection_reason"})

# Stored status values shown by the name a person knows them by.
EMITTER_VALUE_LABELS = {"status": EMITTER_STATUS_LABELS}
SOURCE_VALUE_LABELS = {
    "status": {"approved": "Approved", "pending_review": "Pending review", "rejected": "Rejected"},
}

TEST_LINE_FIELD_LABELS = {
    "label": "Label",
    "expected_mode_name": "Expected Mode",
    "expected_parameters": "Expected Parameters",
    "created_date": "Created",
}

TEST_LINE_FIELDS_ADDED_LATER = frozenset({"created_date"})

MODE_FIELD_LABELS = {
    "name": "Name",
    "pri_type": "PRI Type",
    "notes": "Notes",
    "sources": "Sources",
    "confirmation_quality": "Confirmation Quality (%)",
    "confirmation_quantity": "Confirmation Quantity",
}

MODE_FIELDS_ADDED_LATER = frozenset({"confirmation_quality", "confirmation_quantity"})

# dsl_text deliberately excluded — it's a rendered cache of these other
# fields, not independent data; showing it alongside the real field that
# changed would just repeat the same change in a second, noisier form.
MODE_LINE_FIELD_LABELS = {
    "rf_min_mhz": "RF Min (MHz)",
    "rf_max_mhz": "RF Max (MHz)",
    "pw_min_us": "PW Min (µs)",
    "pw_max_us": "PW Max (µs)",
    "pri_min_us": "PRI Min (µs)",
    "pri_max_us": "PRI Max (µs)",
    "jitter_min_us": "Jitter Min (µs)",
    "jitter_max_us": "Jitter Max (µs)",
    "pri_stagger_values_us": "Stagger Values (µs)",
    "rf_delta": "RF Delta (±MHz)",
    "pw_delta": "PW Delta (±µs)",
    "pri_delta": "PRI Delta (±µs)",
    "frame_time_delta_us": "Frame Time Delta (±µs)",
    "explicit_frame_time_us": "Frame Time (µs, written in)",
    "rf_range_matching": "RF Range Matching",
    "pw_range_matching": "PW Range Matching",
    "pri_range_matching": "PRI Range Matching",
}


MODE_LINE_FIELDS_ADDED_LATER = frozenset({"explicit_frame_time_us"})


def _entry(scope: str, label: str, kind: str, old_value=None, new_value=None) -> dict:
    return {"scope": scope, "label": label, "kind": kind, "old_value": old_value, "new_value": new_value}


def _diff_fields(
    entries: list[dict],
    scope: str,
    old: dict,
    new: dict,
    labels: dict[str, str],
    later_added_fields: frozenset[str] = frozenset(),
    value_labels: dict[str, dict[str, str]] | None = None,
) -> None:
    for field, label in labels.items():
        # Snapshots committed before a field existed simply lack it; that's
        # not a change the user made.
        if field in later_added_fields and (field not in old or field not in new):
            continue
        old_v = old.get(field)
        new_v = new.get(field)
        if old_v != new_v:
            names = (value_labels or {}).get(field, {})
            entries.append(_entry(scope, label, "changed", names.get(old_v, old_v), names.get(new_v, new_v)))


def _num(v) -> str:
    """9500.0 → "9500", 1.25 → "1.25"."""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def _span(lo, hi, unit: str) -> str | None:
    if lo is None and hi is None:
        return None
    if lo == hi or hi is None:
        return f"{_num(lo)} {unit}"
    if lo is None:
        return f"{_num(hi)} {unit}"
    return f"{_num(lo)}–{_num(hi)} {unit}"


def _mode_summary(m: dict) -> str:
    """One line for an added or removed Mode: what it covered."""
    line = m.get("line") or {}
    pri_type = m.get("pri_type") or ""
    parts = [{"fixed": "Fixed", "stagger": "Stagger", "cw": "CW"}.get(pri_type, pri_type)]
    rf = _span(line.get("rf_min_mhz"), line.get("rf_max_mhz"), "MHz")
    if rf:
        parts.append(f"RF {rf}")
    if pri_type == "stagger":
        values = line.get("pri_stagger_values_us") or []
        if values:
            parts.append(f"stagger {', '.join(_num(v) for v in values)} µs")
    elif pri_type != "cw":
        pri = _span(line.get("pri_min_us"), line.get("pri_max_us"), "µs")
        if pri:
            parts.append(f"PRI {pri}")
    pw = _span(line.get("pw_min_us"), line.get("pw_max_us"), "µs")
    if pw:
        parts.append(f"PW {pw}")
    return " · ".join(p for p in parts if p)


def _group_summary(g: dict) -> str:
    scan = _span(g.get("scan_min"), g.get("scan_max"), "s")
    parts = [f"scan {scan}" if scan else None, f"threat priority {g['threat_priority']}" if g.get("threat_priority") is not None else None]
    modes = len(g.get("modes", []))
    parts.append(f"{modes} Mode{'' if modes == 1 else 's'}")
    return " · ".join(p for p in parts if p)


def _source_summary(s: dict) -> str | None:
    return f"dated {s['source_date']}" if s.get("source_date") else None


def _test_line_summary(tl: dict) -> str | None:
    return f"expects {tl['expected_mode_name']}" if tl.get("expected_mode_name") else None


def _with_sources(m: dict) -> dict:
    """The Mode's Sources as one value (snapshots from before Modes could
    have several carry only source_name)."""
    return {**m, "sources": ", ".join(m.get("source_names") or [m.get("source_name") or ""])}


def _diff_modes(entries: list[dict], old_modes: list[dict], new_modes: list[dict]) -> None:
    old_by_id = {m["id"]: m for m in old_modes}
    new_by_id = {m["id"]: m for m in new_modes}

    for mode_id, m in new_by_id.items():
        if mode_id not in old_by_id:
            entries.append(_entry(f"Mode '{m['name']}'", "Added", "added", new_value=_mode_summary(m)))
    for mode_id, m in old_by_id.items():
        if mode_id not in new_by_id:
            entries.append(_entry(f"Mode '{m['name']}'", "Removed", "removed", old_value=_mode_summary(m)))

    for mode_id in set(old_by_id) & set(new_by_id):
        om, nm = _with_sources(old_by_id[mode_id]), _with_sources(new_by_id[mode_id])
        scope = f"Mode '{nm['name']}'"
        _diff_fields(entries, scope, om, nm, MODE_FIELD_LABELS, MODE_FIELDS_ADDED_LATER)
        _diff_fields(
            entries, scope, om.get("line") or {}, nm.get("line") or {}, MODE_LINE_FIELD_LABELS, MODE_LINE_FIELDS_ADDED_LATER
        )


def compute_emitter_diff(old_snapshot: dict, new_snapshot: dict) -> dict:
    entries: list[dict] = []

    _diff_fields(
        entries, "Emitter", old_snapshot, new_snapshot, EMITTER_FIELD_LABELS, value_labels=EMITTER_VALUE_LABELS
    )

    old_groups = {g["id"]: g for g in old_snapshot.get("ew_groups", [])}
    new_groups = {g["id"]: g for g in new_snapshot.get("ew_groups", [])}
    for group_id, g in new_groups.items():
        if group_id not in old_groups:
            entries.append(_entry(f"EW Group '{g['name']}'", "Added", "added", new_value=_group_summary(g)))
            # The group itself is reported above, but Modes created inside a
            # brand-new group are otherwise never itemized individually —
            # matching how a Mode added to an already-existing group is.
            _diff_modes(entries, [], g.get("modes", []))
    for group_id, g in old_groups.items():
        if group_id not in new_groups:
            entries.append(_entry(f"EW Group '{g['name']}'", "Removed", "removed", old_value=_group_summary(g)))
            _diff_modes(entries, g.get("modes", []), [])
    for group_id in set(old_groups) & set(new_groups):
        og, ng = old_groups[group_id], new_groups[group_id]
        _diff_fields(entries, f"EW Group '{ng['name']}'", og, ng, EW_GROUP_FIELD_LABELS)
        _diff_modes(entries, og.get("modes", []), ng.get("modes", []))

    old_sources = {s["id"]: s for s in old_snapshot.get("sources", [])}
    new_sources = {s["id"]: s for s in new_snapshot.get("sources", [])}
    for source_id, s in new_sources.items():
        if source_id not in old_sources:
            entries.append(_entry(f"Source '{s['name']}'", "Added", "added", new_value=_source_summary(s)))
    for source_id, s in old_sources.items():
        if source_id not in new_sources:
            entries.append(_entry(f"Source '{s['name']}'", "Removed", "removed", old_value=_source_summary(s)))
    for source_id in set(old_sources) & set(new_sources):
        os_, ns = old_sources[source_id], new_sources[source_id]
        _diff_fields(
            entries,
            f"Source '{ns['name']}'",
            os_,
            ns,
            SOURCE_FIELD_LABELS,
            SOURCE_FIELDS_ADDED_LATER,
            value_labels=SOURCE_VALUE_LABELS,
        )

    old_lines = {tl["id"]: tl for tl in old_snapshot.get("test_lines", [])}
    new_lines = {tl["id"]: tl for tl in new_snapshot.get("test_lines", [])}
    for line_id, tl in new_lines.items():
        if line_id not in old_lines:
            entries.append(_entry(f"Test Line '{tl['label']}'", "Added", "added", new_value=_test_line_summary(tl)))
    for line_id, tl in old_lines.items():
        if line_id not in new_lines:
            entries.append(_entry(f"Test Line '{tl['label']}'", "Removed", "removed", old_value=_test_line_summary(tl)))
    for line_id in set(old_lines) & set(new_lines):
        ol, nl = old_lines[line_id], new_lines[line_id]
        _diff_fields(
            entries, f"Test Line '{nl['label']}'", ol, nl, TEST_LINE_FIELD_LABELS, TEST_LINE_FIELDS_ADDED_LATER
        )

    return {"entries": entries, "identical": not entries}
