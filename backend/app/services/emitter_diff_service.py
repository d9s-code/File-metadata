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
    "source_name": "Source",
    "function_group_name": "Function Group",
}

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
) -> None:
    for field, label in labels.items():
        # Snapshots committed before a field existed simply lack it; that's
        # not a change the user made.
        if field in later_added_fields and (field not in old or field not in new):
            continue
        old_v = old.get(field)
        new_v = new.get(field)
        if old_v != new_v:
            entries.append(_entry(scope, label, "changed", old_v, new_v))


def _diff_modes(entries: list[dict], old_modes: list[dict], new_modes: list[dict]) -> None:
    old_by_id = {m["id"]: m for m in old_modes}
    new_by_id = {m["id"]: m for m in new_modes}

    for mode_id, m in new_by_id.items():
        if mode_id not in old_by_id:
            entries.append(_entry(f"Mode '{m['name']}'", "Added", "added"))
    for mode_id, m in old_by_id.items():
        if mode_id not in new_by_id:
            entries.append(_entry(f"Mode '{m['name']}'", "Removed", "removed"))

    for mode_id in set(old_by_id) & set(new_by_id):
        om, nm = old_by_id[mode_id], new_by_id[mode_id]
        scope = f"Mode '{nm['name']}'"
        _diff_fields(entries, scope, om, nm, MODE_FIELD_LABELS)
        _diff_fields(
            entries, scope, om.get("line") or {}, nm.get("line") or {}, MODE_LINE_FIELD_LABELS, MODE_LINE_FIELDS_ADDED_LATER
        )


def compute_emitter_diff(old_snapshot: dict, new_snapshot: dict) -> dict:
    entries: list[dict] = []

    _diff_fields(entries, "Emitter", old_snapshot, new_snapshot, EMITTER_FIELD_LABELS)

    old_groups = {g["id"]: g for g in old_snapshot.get("ew_groups", [])}
    new_groups = {g["id"]: g for g in new_snapshot.get("ew_groups", [])}
    for group_id, g in new_groups.items():
        if group_id not in old_groups:
            entries.append(_entry(f"EW Group '{g['name']}'", "Added", "added"))
            # The group itself is reported above, but Modes created inside a
            # brand-new group are otherwise never itemized individually —
            # matching how a Mode added to an already-existing group is.
            _diff_modes(entries, [], g.get("modes", []))
    for group_id, g in old_groups.items():
        if group_id not in new_groups:
            entries.append(_entry(f"EW Group '{g['name']}'", "Removed", "removed"))
            _diff_modes(entries, g.get("modes", []), [])
    for group_id in set(old_groups) & set(new_groups):
        og, ng = old_groups[group_id], new_groups[group_id]
        _diff_fields(entries, f"EW Group '{ng['name']}'", og, ng, EW_GROUP_FIELD_LABELS)
        _diff_modes(entries, og.get("modes", []), ng.get("modes", []))

    old_sources = {s["id"]: s for s in old_snapshot.get("sources", [])}
    new_sources = {s["id"]: s for s in new_snapshot.get("sources", [])}
    for source_id, s in new_sources.items():
        if source_id not in old_sources:
            entries.append(_entry(f"Source '{s['name']}'", "Added", "added"))
    for source_id, s in old_sources.items():
        if source_id not in new_sources:
            entries.append(_entry(f"Source '{s['name']}'", "Removed", "removed"))
    for source_id in set(old_sources) & set(new_sources):
        os_, ns = old_sources[source_id], new_sources[source_id]
        _diff_fields(
            entries, f"Source '{ns['name']}'", os_, ns, SOURCE_FIELD_LABELS, SOURCE_FIELDS_ADDED_LATER
        )

    old_lines = {tl["id"]: tl for tl in old_snapshot.get("test_lines", [])}
    new_lines = {tl["id"]: tl for tl in new_snapshot.get("test_lines", [])}
    for line_id, tl in new_lines.items():
        if line_id not in old_lines:
            entries.append(_entry(f"Test Line '{tl['label']}'", "Added", "added"))
    for line_id, tl in old_lines.items():
        if line_id not in new_lines:
            entries.append(_entry(f"Test Line '{tl['label']}'", "Removed", "removed"))
    for line_id in set(old_lines) & set(new_lines):
        ol, nl = old_lines[line_id], new_lines[line_id]
        _diff_fields(
            entries, f"Test Line '{nl['label']}'", ol, nl, TEST_LINE_FIELD_LABELS, TEST_LINE_FIELDS_ADDED_LATER
        )

    return {"entries": entries, "identical": not entries}
