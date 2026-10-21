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

from app.services.dates import day_text

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
    "scan_delta": "Scan Delta",
    "threat_priority": "Threat Priority",
    "ageout": "Ageout (s)",
}

EW_GROUP_FIELDS_ADDED_LATER = frozenset({"scan_delta"})

SOURCE_FIELD_LABELS = {
    "name": "Name",
    "description": "Description",
    "source_date": "Source Date",
}

SOURCE_FIELDS_ADDED_LATER: frozenset[str] = frozenset()

# Stored status values shown by the name a person knows them by.
SOURCE_VALUE_LABELS: dict = {}

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
    "confirmation_quality": "Confirmation Quality (%)",
    "confirmation_quantity": "Confirmation Quantity",
}

MODE_FIELDS_ADDED_LATER = frozenset({"confirmation_quality", "confirmation_quantity"})

# Kept in a Mode's snapshot but not one of its parameters: its id, its place
# in the list, the generation batch it came from, and its Sources (compared
# on their own, by id, below).
MODE_FIELDS_NOT_COMPARED = frozenset(
    {"id", "line", "sort_order", "generation_batch_id", "source_id", "source_name", "extra_source_ids", "source_names"}
)

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
    "type_data": "PRI Details",
}


MODE_LINE_FIELDS_ADDED_LATER = frozenset({"explicit_frame_time_us"})

MODE_LINE_FIELDS_NOT_COMPARED = frozenset({"dsl_text"})


def _every_field(labels: dict[str, str], not_compared: frozenset[str], old: dict, new: dict) -> tuple[dict, frozenset]:
    """The labels plus any field the snapshots have that they don't name — so
    a field added to a Mode later is never silently left out of its diff —
    and those extra fields, compared only when both snapshots have them."""
    extra = sorted((old.keys() | new.keys()) - labels.keys() - not_compared)
    return {**labels, **{f: f.replace("_", " ").capitalize() for f in extra}}, frozenset(extra)


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
            entries.append(_entry(scope, label, "changed", _named(names, old_v), _named(names, new_v)))


def _named(names: dict, value):
    """The value's display name, if it has one (a list, say, never does)."""
    return names.get(value, value) if isinstance(value, (str, int, float, bool)) else value


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


PRI_TYPE_NAMES = {"fixed": "Fixed", "stagger": "Stagger", "cw": "CW", "xlet": "Xlet"}


def _mode_summary(m: dict) -> str:
    """One line for an added or removed Mode: what it covered."""
    line = m.get("line") or {}
    pri_type = m.get("pri_type") or ""
    parts = [PRI_TYPE_NAMES.get(pri_type, pri_type)]
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
    return f"dated {day_text(s['source_date'])}" if s.get("source_date") else None


def _test_line_summary(tl: dict) -> str | None:
    return f"expects {tl['expected_mode_name']}" if tl.get("expected_mode_name") else None


def _source_names(m: dict) -> str:
    """The Mode's Sources as one value (snapshots from before Modes could
    have several carry only source_name)."""
    return ", ".join(m.get("source_names") or [m.get("source_name") or ""])


def _source_ids(m: dict) -> tuple | None:
    """Its first Source, then the rest in any order; None in a snapshot from
    before Modes could have several."""
    if "extra_source_ids" not in m:
        return None
    return (m.get("source_id"), *sorted(m["extra_source_ids"]))


def _details_text(details) -> str | None:
    """A PRI type's extra details (an Xlet's, say) as one line."""
    if not details:
        return None
    if not isinstance(details, dict):
        return str(details)
    return "; ".join(
        f"{k.replace('_', ' ')}: {', '.join(_num(x) for x in v) if isinstance(v, list) else _num(v)}"
        for k, v in details.items()
    )


def _diff_mode(entries: list[dict], scope: str, old: dict, new: dict, old_group: dict, new_group: dict) -> None:
    """One Mode in both versions: the EW Group it moved to, if it did, then
    every one of its fields."""
    if old_group["id"] != new_group["id"]:
        entries.append(_entry(scope, "EW Group", "changed", old_value=old_group["name"], new_value=new_group["name"]))
    labels, later = _every_field(MODE_FIELD_LABELS, MODE_FIELDS_NOT_COMPARED, old, new)
    _diff_fields(entries, scope, old, new, labels, MODE_FIELDS_ADDED_LATER | later, {"pri_type": PRI_TYPE_NAMES})
    old_ids, new_ids = _source_ids(old), _source_ids(new)
    old_names, new_names = _source_names(old), _source_names(new)
    if (old_ids != new_ids) if old_ids is not None and new_ids is not None else (old_names != new_names):
        entries.append(_entry(scope, "Sources", "changed", old_names, new_names))
    old_line, new_line = dict(old.get("line") or {}), dict(new.get("line") or {})
    for line in (old_line, new_line):
        if "type_data" in line:
            line["type_data"] = _details_text(line["type_data"])
    labels, later = _every_field(MODE_LINE_FIELD_LABELS, MODE_LINE_FIELDS_NOT_COMPARED, old_line, new_line)
    _diff_fields(entries, scope, old_line, new_line, labels, MODE_LINE_FIELDS_ADDED_LATER | later)


def _diff_items(entries: list[dict], scope: str, label: str, old: list[dict] | None, new: list[dict] | None) -> None:
    """A Source's Elements or sequences, as one line: how many, and how many
    were added, removed or changed. Fields one snapshot lacks (saved before
    they were kept) aren't compared; neither is a list one of them lacks."""
    if old is None or new is None:
        return
    before, after = {i["id"]: i for i in old}, {i["id"]: i for i in new}
    added = len(set(after) - set(before))
    removed = len(set(before) - set(after))
    changed = 0
    for item_id in set(before) & set(after):
        a, b = before[item_id], after[item_id]
        if any(a[k] != b[k] for k in set(a) & set(b) if k != "sort_order"):
            changed += 1
    parts = [f"{n} {what}" for n, what in ((added, "added"), (removed, "removed"), (changed, "changed")) if n]
    if parts:
        entries.append(_entry(scope, label, "changed", str(len(old)), f"{len(new)} ({', '.join(parts)})"))


def compute_emitter_diff(old_snapshot: dict, new_snapshot: dict, status_labels: dict[str, str] | None = None) -> dict:
    """`status_labels`: the statuses' names (by key) to show instead of keys."""
    entries: list[dict] = []

    _diff_fields(
        entries,
        "Emitter",
        old_snapshot,
        new_snapshot,
        EMITTER_FIELD_LABELS,
        value_labels={"status": status_labels or {}},
    )

    old_groups = {g["id"]: g for g in old_snapshot.get("ew_groups", [])}
    new_groups = {g["id"]: g for g in new_snapshot.get("ew_groups", [])}
    # Modes are matched by id across EW Groups: one moved to another group
    # (even one since deleted) is the same Mode, not a removal and an addition.
    old_modes = {m["id"]: (m, g) for g in old_groups.values() for m in g.get("modes", [])}
    new_modes = {m["id"] for g in new_groups.values() for m in g.get("modes", [])}
    # A name two Modes share (in different EW Groups) is told apart by the
    # group, so their changes aren't shown together as one Mode's.
    modes_by_name: dict[str, set] = {}
    for groups in (old_groups, new_groups):
        for g in groups.values():
            for m in g.get("modes", []):
                modes_by_name.setdefault(m["name"], set()).add(m["id"])

    def mode_scope(m: dict, g: dict) -> str:
        shared = len(modes_by_name.get(m["name"], ())) > 1
        return f"Mode '{m['name']} ({g['name']})'" if shared else f"Mode '{m['name']}'"

    for group_id, g in new_groups.items():
        if group_id not in old_groups:
            entries.append(_entry(f"EW Group '{g['name']}'", "Added", "added", new_value=_group_summary(g)))
        else:
            _diff_fields(
                entries,
                f"EW Group '{g['name']}'",
                old_groups[group_id],
                g,
                EW_GROUP_FIELD_LABELS,
                EW_GROUP_FIELDS_ADDED_LATER,
            )
        for m in g.get("modes", []):
            if m["id"] in old_modes:
                old_mode, old_group = old_modes[m["id"]]
                _diff_mode(entries, mode_scope(m, g), old_mode, m, old_group, g)
            else:
                entries.append(_entry(mode_scope(m, g), "Added", "added", new_value=_mode_summary(m)))
    for group_id, g in old_groups.items():
        gone = [m for m in g.get("modes", []) if m["id"] not in new_modes]
        if group_id not in new_groups:
            moved = len(g.get("modes", [])) - len(gone)
            summary = _group_summary(g) + (f" ({moved} moved to other EW Groups)" if moved else "")
            entries.append(_entry(f"EW Group '{g['name']}'", "Removed", "removed", old_value=summary))
        for m in gone:
            entries.append(_entry(mode_scope(m, g), "Removed", "removed", old_value=_mode_summary(m)))

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
        _diff_items(entries, f"Source '{ns['name']}'", "Elements", os_.get("elements"), ns.get("elements"))
        _diff_items(
            entries, f"Source '{ns['name']}'", "Sequences", os_.get("parameter_sequences"), ns.get("parameter_sequences")
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
