"""Change notes: the major changes between two MDF snapshots — two versions
of one MDF, or a new MDF and the previous one it follows — as the customer
would see them in what's delivered.

Listed:
  * Platforms and Emitters added or removed (an Emitter once, however many
    Platforms carry it), and Emitters moved onto or off a Platform that
    stays.
  * Emitters updated — only when what the PRS XML export writes for it
    changed: its exported name or designation, EW Groups added, removed or
    renamed, an EW Group's threat priority and ageout (once for the group,
    not for each of its Modes), Modes added or removed, and Modes whose
    exported values changed — name, PRI type, RF, PW, PRI and its jitter,
    stagger steps and frame time (deltas applied, so a delta-only change
    counts) — or that moved to another EW Group. A Mode is listed as changed
    only when its exported element changed; anything the export doesn't
    carry (notes, Sources, scans, signal behaviour, ERP, operational modes…)
    never shows. Many Modes read compactly: "Track 1–100", "and 40 more".
  * Dwell files added, removed, or with their exported content changed.

Left out on purpose: version numbers moving with nothing exported changed,
the MDF's own name, description and status, notes, Sources and statuses.

What counts is an admin setting (app_settings.CHANGE_NOTES_COUNTS): each of
the lists and Mode values above can be switched off, confirmation, scan
period and range matching switched on, and values compared as typed rather
than with their deltas applied. COUNTS_DEFAULT is what counts until then."""

import re

from lxml import etree

from app.services.delta import apply_delta, apply_jitter_delta
from app.services.dwell_xml import build_dwell_xml
from app.services.frametime_service import effective_frametime_us
from app.services.mdf_compare import _collect
from app.services.prs_export.serializer import _append_mode_element, _sanitize, build_emitter_element, to_xml_bytes


# What can be switched on or off, and what counts until an admin changes it.
COUNTS_DEFAULT: dict[str, bool] = {
    # Whole lists
    "platforms": True,  # Platforms added / removed
    "emitters": True,  # Emitters added / removed
    "modes": True,  # an Emitter's Modes added / removed
    "platform_moves": True,  # an Emitter moved onto or off a Platform that stays
    "dwell_files": True,  # dwell files added / removed / changed
    # A Mode's values
    "name": True,
    "pri_type": True,
    "rf": True,
    "pw": True,
    "pri": True,
    "jitter": True,
    "stagger": True,
    "threat_priority": True,
    "ageout": True,
    "confirmation": False,
    "scan_period": False,
    "range_matching": False,
    # Values as exported, deltas applied (off: as typed, deltas ignored)
    "deltas": True,
}

# Each Mode value's key in COUNTS_DEFAULT, by the label a change is reported as.
_VALUE_KEYS = {
    "Name": "name",
    "PRI type": "pri_type",
    "RF": "rf",
    "PW": "pw",
    "PRI": "pri",
    "Jitter": "jitter",
    "Stagger": "stagger",
    "Priority": "threat_priority",
    "Ageout": "ageout",
    "Confirmation": "confirmation",
    "Scan period": "scan_period",
    "Range matching": "range_matching",
}


def resolve_counts(counts: dict[str, bool] | None) -> dict[str, bool]:
    """`counts` over the defaults, unknown keys dropped."""
    return {k: bool((counts or {}).get(k, v)) for k, v in COUNTS_DEFAULT.items()}


def _n(value):
    return None if value is None else round(float(value), 4)


def _pair(lo, hi) -> tuple:
    return (_n(lo), _n(hi))


def exported_values(mode: dict, group: dict, counts: dict[str, bool] | None = None) -> dict[str, object]:
    """A Mode's values, by the label a change is reported as — only those
    that count, and with their deltas applied unless that's switched off."""
    counts = resolve_counts(counts)
    line = mode.get("line") or {}
    pri_type = mode.get("pri_type")
    delta = (lambda lo, hi, d: apply_delta(lo, hi, d)) if counts["deltas"] else (lambda lo, hi, d: (lo, hi))
    values: dict[str, object] = {
        "Name": mode.get("name"),
        "PRI type": pri_type,
        "RF": _pair(*delta(line.get("rf_min_mhz"), line.get("rf_max_mhz"), line.get("rf_delta"))),
        "PW": _pair(*delta(line.get("pw_min_us"), line.get("pw_max_us"), line.get("pw_delta"))),
        "Priority": group.get("threat_priority"),
        "Ageout": _n(group.get("ageout")),
        "Confirmation": (mode.get("confirmation_quality"), mode.get("confirmation_quantity")),
        "Scan period": _pair(group.get("scan_min"), group.get("scan_max")),
        "Range matching": (line.get("rf_range_matching"), line.get("pw_range_matching"), line.get("pri_range_matching")),
    }
    if pri_type == "fixed":
        values["PRI"] = _pair(*delta(line.get("pri_min_us"), line.get("pri_max_us"), line.get("pri_delta")))
        jitter = (lambda lo, hi, d: apply_jitter_delta(lo, hi, d)) if counts["deltas"] else (lambda lo, hi, d: (lo, hi))
        values["Jitter"] = _pair(*jitter(line.get("jitter_min_us"), line.get("jitter_max_us"), line.get("jitter_delta")))
    elif pri_type == "stagger":
        steps = [_n(v) for v in line.get("pri_stagger_values_us") or []]
        frame = effective_frametime_us(line.get("pri_stagger_values_us") or [], line.get("explicit_frame_time_us"))
        frame_range = _pair(*delta(frame, frame, line.get("frame_time_delta_us"))) if frame is not None else None
        values["Stagger"] = (tuple(steps), frame_range)
    return {label: v for label, v in values.items() if counts[_VALUE_KEYS[label]]}


def _modes(emitter_snapshot: dict, counts: dict[str, bool] | None = None) -> dict[str, tuple[str, dict]]:
    """Each Mode of an Emitter by id: (its name, the values that count)."""
    out = {}
    for group in emitter_snapshot.get("ew_groups", []):
        for mode in group.get("modes", []):
            out[str(mode["id"])] = (mode.get("name"), exported_values(mode, group, counts))
    return out


def _emitter_label(emitter: dict) -> str:
    designation = (emitter.get("snapshot") or {}).get("designation")
    return f"{designation} — {emitter['name']}" if designation else emitter["name"]


def _by_name(items: list[dict]) -> list[dict]:
    return sorted(items, key=lambda i: (i["kind"] != "Platform", i["kind"] != "Emitter", i["name"].lower()))


# Values that belong to the EW Group (one per group in the export, not per Mode).
_GROUP_VALUES = ("Priority", "Ageout", "Scan period")


def _exported_mode(mode: dict, group: dict) -> bytes:
    """A Mode's element, exactly as the PRS export writes it."""
    holder = etree.Element("Modes")
    _append_mode_element(holder, mode, scan_name=group["name"])
    return etree.tostring(holder[0])


def _exported_emitter(snapshot: dict) -> bytes:
    return to_xml_bytes(build_emitter_element({"name": "", **snapshot}))


def _number(name: str) -> list:
    """Sorts "Track 2" before "Track 10"."""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", name or "")]


# How many names (or runs of names) a list shows before "and N more".
NAMES_SHOWN = 12


def compact_names(names: list[str]) -> str:
    """Names in natural order, runs of numbered ones as a range —
    "Track 1–100, Search 3, Search 5" — at most NAMES_SHOWN parts, then
    "and N more"."""
    numbered: dict[str, list[int]] = {}
    parts: list[tuple[list, str, int]] = []  # (sort key, text, Modes in it)
    for name in names:
        m = re.fullmatch(r"(.*?)(\d+)", name or "")
        if m and " → " not in name:
            numbered.setdefault(m.group(1), []).append(int(m.group(2)))
        else:
            parts.append((_number(name), name, 1))
    for prefix, numbers in numbered.items():
        numbers = sorted(set(numbers))
        run = [numbers[0]]
        for n in [*numbers[1:], None]:
            if n is not None and n == run[-1] + 1:
                run.append(n)
                continue
            if len(run) >= 3:
                parts.append((_number(f"{prefix}{run[0]}"), f"{prefix}{run[0]}–{run[-1]}", len(run)))
            else:
                parts += [(_number(f"{prefix}{x}"), f"{prefix}{x}", 1) for x in run]
            if n is not None:
                run = [n]
    parts.sort(key=lambda p: p[0])
    shown, rest = parts[:NAMES_SHOWN], parts[NAMES_SHOWN:]
    text = ", ".join(p[1] for p in shown)
    if rest:
        text += f" and {sum(p[2] for p in rest)} more"
    return text


def _modes_word(n: int) -> str:
    return f"{n} Mode{'' if n == 1 else 's'}"


def _mode_changes(old: dict, new: dict, counts: dict[str, bool]) -> dict | None:
    """What changed in an Emitter, as the PRS XML export has it: its own
    exported name and designation, its EW Groups, and its Modes added,
    removed and changed; None when nothing that counts changed — and always
    None when its export is the same."""
    if _exported_emitter(old) == _exported_emitter(new):
        return None
    emitter: list[str] = []
    if counts["name"]:
        if _sanitize(old.get("name")) != _sanitize(new.get("name")) and old.get("name") and new.get("name"):
            emitter.append(f"Renamed {old['name']} → {new['name']}")
        a, b = old.get("designation"), new.get("designation")
        if (a or None) != (b or None):
            emitter.append(f"Designation {a or '—'} → {b or '—'}")
        elif not b and (old.get("description") or None) != (new.get("description") or None):
            emitter.append("Description changed (exported as it has no designation)")

    old_g = {_group_key(g): g for g in old.get("ew_groups", [])}
    new_g = {_group_key(g): g for g in new.get("ew_groups", [])}
    groups: list[str] = []
    if counts["modes"]:
        groups += [f"EW Group {new_g[g]['name']} added" for g in sorted(new_g.keys() - old_g.keys(), key=lambda g: _number(new_g[g]["name"]))]
        groups += [f"EW Group {old_g[g]['name']} removed" for g in sorted(old_g.keys() - new_g.keys(), key=lambda g: _number(old_g[g]["name"]))]
    for gid in sorted(old_g.keys() & new_g.keys(), key=lambda g: _number(new_g[g]["name"])):
        a, b = old_g[gid], new_g[gid]
        said = []
        if counts["name"] and _sanitize(a["name"]) != _sanitize(b["name"]):
            said.append(f"renamed from {a['name']}")
        if counts["threat_priority"] and a.get("threat_priority") != b.get("threat_priority"):
            said.append(f"priority {a.get('threat_priority') if a.get('threat_priority') is not None else '—'} → {b.get('threat_priority') if b.get('threat_priority') is not None else '—'}")
        if counts["ageout"] and _n(a.get("ageout")) != _n(b.get("ageout")):
            said.append(f"ageout {_num_text(a.get('ageout'))} → {_num_text(b.get('ageout'))} s")
        if counts["scan_period"] and _pair(a.get("scan_min"), a.get("scan_max")) != _pair(b.get("scan_min"), b.get("scan_max")):
            said.append("scan period changed")
        if said:
            groups.append(f"EW Group {b['name']}: " + ", ".join(said))

    def table(snapshot: dict) -> dict[str, dict]:
        out = {}
        for group in snapshot.get("ew_groups", []):
            for mode in group.get("modes", []):
                out[str(mode["id"])] = {
                    "name": mode.get("name"),
                    "group": _group_key(group),
                    "values": exported_values(mode, group, counts),
                    "xml": _exported_mode(mode, group),
                }
        return out

    a_m, b_m = table(old), table(new)
    added = [b_m[k]["name"] for k in b_m.keys() - a_m.keys()] if counts["modes"] else []
    removed = [a_m[k]["name"] for k in a_m.keys() - b_m.keys()] if counts["modes"] else []
    changed = []
    for k in a_m.keys() & b_m.keys():
        a, b = a_m[k], b_m[k]
        if a["xml"] == b["xml"]:
            continue  # nothing the export writes for it changed
        fields = [
            label
            for label, value in b["values"].items()
            if label not in _GROUP_VALUES and a["values"].get(label) != value and not (label == "Name" and _sanitize(a["name"]) == _sanitize(b["name"]))
        ]
        # A PRI type change carries its PRI, jitter or stagger with it.
        if "PRI type" in fields:
            fields = [f for f in fields if f not in ("PRI", "Jitter", "Stagger")]
        if a["group"] != b["group"] and counts["modes"]:
            fields.append(f"moved from EW Group {old_g.get(a['group'], {}).get('name', '—')} to {new_g.get(b['group'], {}).get('name', '—')}")
        if fields:
            name = b["name"] if "Name" not in fields else f"{a['name']} → {b['name']}"
            changed.append({"mode": name, "fields": fields})
    if not (emitter or groups or added or removed or changed):
        return None
    return {
        "emitter_changes": emitter,
        "group_changes": groups,
        "modes_added": sorted(added, key=_number),
        "modes_removed": sorted(removed, key=_number),
        "modes_changed": sorted(changed, key=lambda c: _number(c["mode"])),
    }


def _group_key(group: dict) -> str:
    """An EW Group by id (by name in snapshots from before groups had one)."""
    return str(group["id"]) if group.get("id") else f"name:{group.get('name')}"


def _num_text(v) -> str:
    return "—" if v is None else (str(int(v)) if float(v).is_integer() else str(v))


def _mode_items(m: dict) -> list[str]:
    """What changed in an Emitter, in words, one line each — Modes that
    changed the same way on one line ("RF changed on 40 Modes: Track 1–40")."""
    items = [*m.get("emitter_changes", []), *m.get("group_changes", [])]
    if m["modes_added"]:
        items.append(f"{_modes_word(len(m['modes_added']))} added: {compact_names(m['modes_added'])}")
    if m["modes_removed"]:
        items.append(f"{_modes_word(len(m['modes_removed']))} removed: {compact_names(m['modes_removed'])}")
    alike: dict[tuple, list[str]] = {}
    for c in m["modes_changed"]:
        alike.setdefault(tuple(c["fields"]), []).append(c["mode"])
    for fields, names in sorted(alike.items(), key=lambda kv: _number(kv[1][0])):
        values = [f for f in fields if not f.startswith("moved ")]
        what = ", ".join([*([f"{', '.join(values)} changed"] if values else []), *(f for f in fields if f.startswith("moved "))])
        items.append(f"{names[0]}: {what}" if len(names) == 1 else f"{what} on {_modes_word(len(names))}: {compact_names(names)}")
    return items


def _dwell_files(snapshot: dict) -> dict[str, dict]:
    return {d["dwell_file_id"]: d for d in snapshot.get("dwell_files", [])}


def _dwell_changes(old: dict, new: dict) -> list[str]:
    """What changed in a dwell file's exported content, in words."""
    a, b = old.get("snapshot") or {}, new.get("snapshot") or {}
    if build_dwell_xml(a) == build_dwell_xml(b):
        return []
    items = []
    if (a.get("timeout"), a.get("setup_time")) != (b.get("timeout"), b.get("setup_time")):
        items.append("Settings changed")
    sa = {s["strategy_id"]: s for s in a.get("strategies", [])}
    sb = {s["strategy_id"]: s for s in b.get("strategies", [])}
    name = lambda s: (s.get("snapshot") or {}).get("name") or "a Strategy"  # noqa: E731
    items += [f"Strategy {name(sb[k])} added" for k in sb.keys() - sa.keys()]
    items += [f"Strategy {name(sa[k])} removed" for k in sa.keys() - sb.keys()]
    content = ("dwells", "manual_collect_time_ms", "rapid_df", "split_mode")
    for k in sa.keys() & sb.keys():
        before, after = sa[k].get("snapshot") or {}, sb[k].get("snapshot") or {}
        if any(before.get(f) != after.get(f) for f in content):
            items.append(f"Strategy {name(sb[k])}: dwells changed")
    return items or ["Its dwells changed"]


def change_notes(old: dict, new: dict, counts: dict[str, bool] | None = None) -> dict:
    """The major changes from snapshot `old` to snapshot `new` ({} for none):
    {"added": [...], "removed": [...], "updated": [...]}, each entry with
    its kind (Platform, Emitter, Dwell file), name and what it holds or what
    changed. `counts`: what counts (see COUNTS_DEFAULT)."""
    counts = resolve_counts(counts)
    old_platforms, old_emitters, _ = _collect(old)
    new_platforms, new_emitters, _ = _collect(new)
    added: list[dict] = []
    removed: list[dict] = []
    updated: list[dict] = []

    for pid in (new_platforms.keys() - old_platforms.keys()) if counts["platforms"] else ():
        p = new_platforms[pid]
        n = len(p["emitters"])
        added.append({"kind": "Platform", "name": p["name"], "detail": f"{n} Emitter{'' if n == 1 else 's'}"})
    for pid in (old_platforms.keys() - new_platforms.keys()) if counts["platforms"] else ():
        removed.append({"kind": "Platform", "name": old_platforms[pid]["name"], "detail": None})

    for eid in (new_emitters.keys() - old_emitters.keys()) if counts["emitters"] else ():
        e = new_emitters[eid]
        n = len(_modes(e["snapshot"]))
        added.append(
            {"kind": "Emitter", "name": _emitter_label(e), "detail": f"on {', '.join(sorted(e['platforms']))} · {n} Mode{'' if n == 1 else 's'}"}
        )
    for eid in (old_emitters.keys() - new_emitters.keys()) if counts["emitters"] else ():
        removed.append({"kind": "Emitter", "name": _emitter_label(old_emitters[eid]), "detail": None})
    for eid in old_emitters.keys() & new_emitters.keys():
        modes = _mode_changes(old_emitters[eid]["snapshot"], new_emitters[eid]["snapshot"], counts)
        if modes:
            counted = {k: v for k, v in modes.items() if k.startswith("modes_")}
            updated.append({"kind": "Emitter", "name": _emitter_label(new_emitters[eid]), **counted, "items": _mode_items(modes)})

    # A Platform both sides have: Emitters moved onto or off it (when the
    # Emitter itself stays in the MDF — otherwise it's listed as added/removed).
    for pid in (old_platforms.keys() & new_platforms.keys()) if counts["platform_moves"] else ():
        before, after = old_platforms[pid]["emitters"], new_platforms[pid]["emitters"]
        items = [
            f"Now carries {_emitter_label(new_emitters[e])}"
            for e in sorted(after.keys() - before.keys(), key=lambda e: after[e].lower())
            if e in old_emitters
        ]
        items += [
            f"No longer carries {_emitter_label(new_emitters[e])}"
            for e in sorted(before.keys() - after.keys(), key=lambda e: before[e].lower())
            if e in new_emitters
        ]
        if items:
            updated.append({"kind": "Platform", "name": new_platforms[pid]["name"], "items": items})

    old_dwell, new_dwell = (_dwell_files(old), _dwell_files(new)) if counts["dwell_files"] else ({}, {})
    for fid in new_dwell.keys() - old_dwell.keys():
        added.append({"kind": "Dwell file", "name": new_dwell[fid]["name"], "detail": None})
    for fid in old_dwell.keys() - new_dwell.keys():
        removed.append({"kind": "Dwell file", "name": old_dwell[fid]["name"], "detail": None})
    for fid in old_dwell.keys() & new_dwell.keys():
        items = _dwell_changes(old_dwell[fid], new_dwell[fid])
        if items:
            updated.append({"kind": "Dwell file", "name": new_dwell[fid]["name"], "items": items})

    return {"added": _by_name(added), "removed": _by_name(removed), "updated": _by_name(updated)}
