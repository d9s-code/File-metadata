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
    "illumination_time_ms": "Illumination time (ms)",
    "description": "Description",
    "status": "Status",
}

# Fields that didn't exist before need no entry here: a snapshot saved
# before them had none, so their absence reads as empty (illumination time,
# operational modes and their link, plan, scans and the links to them).
EMITTER_FIELDS_ADDED_LATER: frozenset[str] = frozenset()

EW_GROUP_FIELD_LABELS = {
    "name": "Name",
    "scan_min": "Scan Min",
    "scan_max": "Scan Max",
    "scan_delta": "Scan Delta",
    "threat_priority": "Priority",
    "ageout": "Ageout (s)",
    "erp_min_dbm": "ERP min (dBm)",
    "erp_max_dbm": "ERP max (dBm)",
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
    "group_pulses": "Pulses per group",
    "group_off_ms": "Off between groups (ms)",
}

MODE_FIELDS_ADDED_LATER = frozenset({"confirmation_quality", "confirmation_quantity"})

# Kept in a Mode's snapshot but not one of its parameters: its id, its place
# in the list, the generation batch it came from, and its Sources (compared
# on their own, by id, below).
MODE_FIELDS_NOT_COMPARED = frozenset(
    {
        "id",
        "line",
        "sort_order",
        "generation_batch_id",
        "source_id",
        "source_name",
        "extra_source_ids",
        "source_names",
        # Compared by the operational mode's and scan's names instead (see _diff_mode).
        "operational_mode_id",
        "scan_id",
        # Compared as text (see _diff_mode).
        "signal",
    }
)

OPERATIONAL_MODE_FIELD_LABELS = {
    "name": "Name",
    "description": "Description",
    "emission": "Emission",
    "plan": "Plan",
}

SCAN_FIELD_LABELS = {
    "name": "Name",
    "pattern": "Pattern",
    "params": "Values",
    "beam_az_deg": "Beamwidth azimuth (°)",
    "beam_el_deg": "Beamwidth elevation (°)",
    "illumination_ms": "Illumination time typed in (ms)",
    "blanked_sectors": "Blanked sectors",
    "description": "Description",
}

SCAN_PATTERN_NAMES = {
    "circular": "Circular",
    "sector_uni": "Sector, one way",
    "sector_bi": "Sector, both ways",
    "raster": "Raster",
    "helical": "Helical",
    "spiral": "Spiral",
    "palmer": "Palmer",
    "palmer_raster": "Palmer-raster",
    "conical": "Conical",
    "lobe_switching": "Lobe switching",
    "steady": "Steady (no scan)",
    "esa": "Electronic (ESA) dwell",
    "other": "Other",
}

# A scan's values by name, with their units.
SCAN_PARAM_LABELS = {
    "period_s": ("period", "s"),
    "sector_deg": ("sector", "°"),
    "sweep_s": ("sweep", "s"),
    "flyback_s": ("flyback", "s"),
    "bars": ("bars", ""),
    "bar_spacing_deg": ("bar spacing", "°"),
    "frame_s": ("frame", "s"),
    "levels": ("levels", ""),
    "cone_deg": ("cone", "°"),
    "turns": ("turns", ""),
    "nutation_deg": ("nutation", "°"),
    "nutation_hz": ("nutation", "Hz"),
    "rate_hz": ("rate", "Hz"),
    "pulses": ("pulses", ""),
    "dwell_ms": ("dwell", "ms"),
    "revisit_s": ("revisit", "s"),
}


def scan_params_text(params: dict | None) -> str | None:
    """"period 10 s ± 0.2, sector 90°": a scan's values, as read."""
    if not params:
        return None
    parts = []
    for key, (label, unit) in SCAN_PARAM_LABELS.items():
        if params.get(key) is None:
            continue
        sep = "" if unit in ("°", "") else " "
        text = f"{label} {_num(params[key])}{sep}{unit}"
        if params.get(f"{key}_delta"):
            text += f" ± {_num(params[key + '_delta'])}"
        parts.append(text)
    return ", ".join(parts) or None


_CODES = {
    "barker": "Barker",
    "frank": "Frank",
    "p1": "P1",
    "p2": "P2",
    "p3": "P3",
    "p4": "P4",
    "polyphase": "Polyphase",
    "binary": "Binary",
    "other": "Phase",
}

_POLARISATION = {
    "horizontal": "horizontal",
    "vertical": "vertical",
    "circular_left": "circular (left)",
    "circular_right": "circular (right)",
    "slant": "slant",
    "agile": "agile",
}


def _list(values: list, unit: str) -> str:
    shown = "/".join(_num(v) for v in values[:8]) + ("…" if len(values) > 8 else "")
    return f"{shown} {unit}"


def signal_text(signal: dict | None) -> str | None:
    """"RF hopping over 4 channels (9400/…), a hop every 8 pulses · PRI sliding up over 20 ms · LFM 5 MHz up · horizontal"."""
    if not signal:
        return None
    parts = []
    rf = signal.get("rf")
    if rf:
        k = rf["kind"]
        if k == "agile":
            parts.append("RF agile, pulse to pulse")
        elif k == "hopping":
            hop = f"every {rf['hop_pulses']} pulses" if rf.get("hop_pulses") else f"every {_num(rf['hop_ms'])} ms"
            order = " at random" if rf.get("order") == "random" else ""
            parts.append(f"RF hopping over {len(rf['channels_mhz'])} channels ({_list(rf['channels_mhz'], 'MHz')}), a hop {hop}{order}")
        elif k == "swept":
            parts.append(f"RF swept in {_num(rf['sweep_ms'])} ms{' (triangle)' if rf.get('shape') == 'triangle' else ''}")
        elif k == "diverse":
            parts.append(f"RF on {len(rf['channels_mhz'])} channels at once ({_list(rf['channels_mhz'], 'MHz')})")
    pri = signal.get("pri")
    if pri:
        k = pri["kind"]
        if k == "sliding":
            parts.append(f"PRI sliding {pri.get('shape') or 'up'} over {_num(pri['period_ms'])} ms")
        elif k == "wobulated":
            parts.append(f"PRI wobulated over {_num(pri['period_ms'])} ms")
        elif k == "dwell_switch":
            parts.append(f"PRI dwell & switch {_list(pri['values_us'], 'µs')}, {pri['dwell_pulses']} pulses each")
        elif k == "random":
            parts.append("PRI random in its range")
    pw = signal.get("pw")
    if pw:
        parts.append(f"PW {'agile' if pw['kind'] == 'agile' else 'in sequence'} {_list(pw['values_us'], 'µs')}")
    mod = signal.get("modulation")
    if mod:
        k = mod["kind"]
        if k in ("lfm", "nlfm"):
            parts.append(f"{k.upper()} {_num(mod['bandwidth_mhz'])} MHz{' ' + mod['direction'] if mod.get('direction') else ''}")
        elif k == "phase":
            code = _CODES.get(mod.get("code") or "other", "Phase")
            chips = f", {_num(mod['chip_us'])} µs chips" if mod.get("chip_us") else ""
            parts.append(f"{code} code of {mod['code_length']}{chips}")
        elif k == "fsk":
            parts.append(f"FSK, {mod['frequencies']} frequencies")
        elif k == "unknown":
            parts.append("modulated (unknown)")
    if signal.get("polarisation"):
        parts.append(_POLARISATION.get(signal["polarisation"], signal["polarisation"]))
    return " · ".join(parts) or None


def blanked_text(sectors: list | None) -> str | None:
    """"350–10°, 90–120°"."""
    if not sectors:
        return None
    return ", ".join(f"{_num(s['from_deg'])}–{_num(s['to_deg'])}°" for s in sectors)


def emission_text(emission: dict | None, mode_names: dict[str, str]) -> str | None:
    """"Track 1 × 8 pulses, off 2 ms, Track 2 for 5 ms · on 2 s, off 8 s": an operational mode's emission, as read."""
    if not emission:
        return None
    steps = []
    for item in emission.get("timeline") or []:
        if item.get("kind") == "off":
            steps.append(f"off {_num(item['ms'])} ms")
        else:
            name = mode_names.get(item.get("mode_id") or "", "a deleted Mode")
            steps.append(f"{name} × {item['pulses']} pulses" if item.get("pulses") else f"{name} for {_num(item['ms'])} ms")
    parts = [", ".join(steps)] if steps else []
    if emission.get("on_s") is not None:
        parts.append(f"on {_num(emission['on_s'])} s, off {_num(emission['off_s'])} s")
    return " · ".join(parts) or None


def _scan_summary(x: dict) -> str:
    values = scan_params_text(x.get("params"))
    return f"{x['name']} ({SCAN_PATTERN_NAMES.get(x['pattern'], x['pattern'])}" + (f": {values})" if values else ")")

OPERATIONAL_MODE_FIELDS_ADDED_LATER: frozenset[str] = frozenset()


def plan_text(plan: dict | None) -> str | None:
    """"RF 9400–9450 MHz; PRI (dwell & switch) 100 µs × 64 pulses / 120 µs; PW 1 µs"."""
    if not plan:
        return None

    def value(v: dict, unit: str) -> str:
        lo, hi = v.get("min"), v.get("max")
        text = _num(lo) if hi is None or hi == lo else f"{_num(lo)}–{_num(hi)}"
        dwell = (
            f" × {v['dwell_pulses']} pulses" if v.get("dwell_pulses") else f" × {_num(v['dwell_ms'])} ms" if v.get("dwell_ms") else ""
        )
        pw = ""
        if v.get("pw_min") is not None:
            lo_pw, hi_pw = v["pw_min"], v.get("pw_max")
            pw = f" ↔ PW {_num(lo_pw) if hi_pw is None or hi_pw == lo_pw else f'{_num(lo_pw)}–{_num(hi_pw)}'} µs"
        return f"{text} {unit}{dwell}{pw}"

    def stagger(st: dict) -> str:
        text = "/".join(_num(x) for x in st.get("steps", [])) + " µs"
        if st.get("pw_steps"):
            text += " ↔ PW " + "/".join(_num(x) for x in st["pw_steps"]) + " µs"
        if st.get("frame_time_delta_us") is not None:
            text += f" (frame ±{_num(st['frame_time_delta_us'])})"
        return text

    parts = []
    for key, label, unit in (("rf", "RF", "MHz"), ("pri", "PRI", "µs"), ("pw", "PW", "µs")):
        values = plan.get(key) or []
        if values:
            name = f"{label} (dwell & switch)" if key == "pri" and plan.get("pri_dwell_switch") else label
            parts.append(f"{name} " + " / ".join(value(v, unit) for v in values))
        if key == "pri" and plan.get("pri_stagger"):
            parts.append("PRI (stagger) " + " | ".join(stagger(st) for st in plan["pri_stagger"]))
    return "; ".join(parts) or None

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
    "jitter_delta": "Jitter Delta (±µs)",
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
    parts = [f"scan {scan}" if scan else None, f"priority {g['threat_priority']}" if g.get("threat_priority") is not None else None]
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


def _diff_mode(
    entries: list[dict],
    scope: str,
    old: dict,
    new: dict,
    old_group: dict,
    new_group: dict,
    operational_names: tuple[dict, dict] = ({}, {}),
    scan_names: tuple[dict, dict] = ({}, {}),
) -> None:
    """One Mode in both versions: the EW Group it moved to, if it did, the
    operational mode and scan it's linked to, then every one of its fields."""
    if old_group["id"] != new_group["id"]:
        entries.append(_entry(scope, "EW Group", "changed", old_value=old_group["name"], new_value=new_group["name"]))
    # A snapshot from before operational modes (or scans) had none: no link.
    _link_entry(entries, scope, "Operational mode", old.get("operational_mode_id"), new.get("operational_mode_id"), operational_names)
    _link_entry(entries, scope, "Scan", old.get("scan_id"), new.get("scan_id"), scan_names)
    old_signal, new_signal = signal_text(old.get("signal")), signal_text(new.get("signal"))
    if old_signal != new_signal:
        entries.append(_entry(scope, "Signal", "changed", old_value=old_signal, new_value=new_signal))
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


def _path(operational: dict[str, dict], op_id: str | None) -> str | None:
    """"TRACK › Track 2": its name under its parents'; None at the top."""
    names, seen = [], set()
    while op_id and op_id in operational and op_id not in seen:
        seen.add(op_id)
        names.append(operational[op_id]["name"])
        op_id = operational[op_id].get("parent_id")
    return " › ".join(reversed(names)) or None


def _operational_summary(o: dict) -> str:
    return o["name"]


def _link_entry(entries: list[dict], scope: str, label: str, old_id, new_id, names: tuple[dict, dict]) -> None:
    """A link (to an operational mode or a scan) by name; one renamed since says so."""
    if old_id == new_id:
        return
    old_names, new_names = names
    old_label = old_names.get(old_id) if old_id else None
    # The one it left, renamed since: said, so "A → A" never reads as no change.
    if old_label and old_id in new_names and new_names[old_id] != old_label:
        old_label = f"{old_label} (now '{new_names[old_id]}')"
    entries.append(_entry(scope, label, "changed", old_value=old_label, new_value=new_names.get(new_id) if new_id else None))


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
        EMITTER_FIELDS_ADDED_LATER,
        value_labels={"status": status_labels or {}},
    )

    # Scans — a snapshot from before them had none: what's there now was added.
    old_scans = {x["id"]: x for x in old_snapshot.get("scans", [])}
    new_scans = {x["id"]: x for x in new_snapshot.get("scans", [])}
    for x_id, x in new_scans.items():
        scope = f"Scan '{x['name']}'"
        if x_id not in old_scans:
            entries.append(_entry(scope, "Added", "added", new_value=_scan_summary(x)))
        else:
            as_text = [
                {
                    **y,
                    "params": scan_params_text(y.get("params")),
                    "pattern": SCAN_PATTERN_NAMES.get(y["pattern"], y["pattern"]),
                    "blanked_sectors": blanked_text(y.get("blanked_sectors")),
                }
                for y in (old_scans[x_id], x)
            ]
            _diff_fields(entries, scope, *as_text, SCAN_FIELD_LABELS)
    for x_id, x in old_scans.items():
        if x_id not in new_scans:
            entries.append(_entry(f"Scan '{x['name']}'", "Removed", "removed", old_value=_scan_summary(x)))
    scan_names = ({k: v["name"] for k, v in old_scans.items()}, {k: v["name"] for k, v in new_scans.items()})

    # Mode names by id, for an operational mode's emission timeline.
    old_mode_names = {m["id"]: m["name"] for g in old_snapshot.get("ew_groups", []) for m in g.get("modes", [])}
    new_mode_names = {m["id"]: m["name"] for g in new_snapshot.get("ew_groups", []) for m in g.get("modes", [])}

    # Operational modes — only when both snapshots have them (older ones don't).
    old_operational = {o["id"]: o for o in old_snapshot.get("operational_modes", [])}
    new_operational = {o["id"]: o for o in new_snapshot.get("operational_modes", [])}
    # A snapshot from before them had none: what's there now was added.
    for o_id, o in new_operational.items():
        scope = f"Operational mode '{o['name']}'"
        if o_id not in old_operational:
            entries.append(_entry(scope, "Added", "added", new_value=_operational_summary(o)))
        else:
            with_plan_text = [
                {**x, "plan": plan_text(x.get("plan")), "emission": emission_text(x.get("emission"), names)}
                for x, names in ((old_operational[o_id], old_mode_names), (o, new_mode_names))
            ]
            _diff_fields(
                entries, scope, *with_plan_text, OPERATIONAL_MODE_FIELD_LABELS, OPERATIONAL_MODE_FIELDS_ADDED_LATER
            )
            before, after = old_operational[o_id], o
            _link_entry(entries, scope, "Scan", before.get("scan_id"), after.get("scan_id"), scan_names)
            if before.get("parent_id") != after.get("parent_id"):
                entries.append(
                    _entry(
                        scope,
                        "Under",
                        "changed",
                        old_value=_path(old_operational, before.get("parent_id")),
                        new_value=_path(new_operational, after.get("parent_id")),
                    )
                )
    for o_id, o in old_operational.items():
        if o_id not in new_operational:
            entries.append(
                _entry(f"Operational mode '{o['name']}'", "Removed", "removed", old_value=_operational_summary(o))
            )
    operational_names = (
        {k: _path(old_operational, k) for k in old_operational},
        {k: _path(new_operational, k) for k in new_operational},
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
                _diff_mode(entries, mode_scope(m, g), old_mode, m, old_group, g, operational_names, scan_names)
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
