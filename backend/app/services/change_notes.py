"""Change notes: the major changes between two MDF snapshots — two versions
of one MDF, or a new MDF and the previous one it follows — as the customer
would see them in what's delivered.

Listed:
  * Platforms and Emitters added or removed (an Emitter once, however many
    Platforms carry it), and Emitters moved onto or off a Platform that
    stays.
  * Emitters updated: Modes added or removed, and Modes whose exported
    values changed — name, PRI type, RF, PW, PRI and its jitter, stagger
    steps and frame time (deltas applied, so a delta-only change counts),
    threat priority and ageout.
  * Dwell files added, removed, or with their exported content changed.

Left out on purpose: version numbers moving with nothing exported changed,
the MDF's own name, description and status, confirmation quality and
quantity, scan period, range matching, notes, Sources and statuses."""

from app.services.delta import apply_delta
from app.services.dwell_xml import build_dwell_xml
from app.services.frametime_service import effective_frametime_us
from app.services.mdf_compare import _collect


def _n(value):
    return None if value is None else round(float(value), 4)


def _pair(lo, hi) -> tuple:
    return (_n(lo), _n(hi))


def exported_values(mode: dict, group: dict) -> dict[str, object]:
    """What the export writes for a Mode, by the label a change is reported
    as — only the values that count as a major change."""
    line = mode.get("line") or {}
    pri_type = mode.get("pri_type")
    values: dict[str, object] = {
        "Name": mode.get("name"),
        "PRI type": pri_type,
        "RF": _pair(*apply_delta(line.get("rf_min_mhz"), line.get("rf_max_mhz"), line.get("rf_delta"))),
        "PW": _pair(*apply_delta(line.get("pw_min_us"), line.get("pw_max_us"), line.get("pw_delta"))),
        "Threat priority": group.get("threat_priority"),
        "Ageout": _n(group.get("ageout")),
    }
    if pri_type == "fixed":
        values["PRI"] = _pair(*apply_delta(line.get("pri_min_us"), line.get("pri_max_us"), line.get("pri_delta")))
        values["Jitter"] = _pair(line.get("jitter_min_us"), line.get("jitter_max_us"))
    elif pri_type == "stagger":
        steps = [_n(v) for v in line.get("pri_stagger_values_us") or []]
        frame = effective_frametime_us(line.get("pri_stagger_values_us") or [], line.get("explicit_frame_time_us"))
        frame_range = _pair(*apply_delta(frame, frame, line.get("frame_time_delta_us"))) if frame is not None else None
        values["Stagger"] = (tuple(steps), frame_range)
    return values


def _modes(emitter_snapshot: dict) -> dict[str, tuple[str, dict]]:
    """Each Mode of an Emitter by id: (its name, its exported values)."""
    out = {}
    for group in emitter_snapshot.get("ew_groups", []):
        for mode in group.get("modes", []):
            out[str(mode["id"])] = (mode.get("name"), exported_values(mode, group))
    return out


def _emitter_label(emitter: dict) -> str:
    designation = (emitter.get("snapshot") or {}).get("designation")
    return f"{designation} — {emitter['name']}" if designation else emitter["name"]


def _by_name(items: list[dict]) -> list[dict]:
    return sorted(items, key=lambda i: (i["kind"] != "Platform", i["kind"] != "Emitter", i["name"].lower()))


def _mode_changes(old: dict, new: dict) -> dict | None:
    """Modes added, removed and changed between two versions of an Emitter;
    None when nothing exported changed."""
    a, b = _modes(old), _modes(new)
    added = sorted(b[k][0] for k in b.keys() - a.keys())
    removed = sorted(a[k][0] for k in a.keys() - b.keys())
    changed = []
    for k in sorted(a.keys() & b.keys(), key=lambda k: (b[k][0] or "").lower()):
        fields = [label for label, value in b[k][1].items() if a[k][1].get(label) != value]
        # A PRI type change carries its PRI, jitter or stagger with it.
        if "PRI type" in fields:
            fields = [f for f in fields if f not in ("PRI", "Jitter", "Stagger")]
        if fields:
            name = b[k][0] if a[k][0] == b[k][0] else f"{a[k][0]} → {b[k][0]}"
            changed.append({"mode": name, "fields": fields})
    if not (added or removed or changed):
        return None
    return {"modes_added": added, "modes_removed": removed, "modes_changed": changed}


def _mode_items(m: dict) -> list[str]:
    """An Emitter's Mode changes in words, one line each."""
    items = []
    if m["modes_added"]:
        n = len(m["modes_added"])
        items.append(f"{n} Mode{'' if n == 1 else 's'} added: {', '.join(m['modes_added'])}")
    if m["modes_removed"]:
        n = len(m["modes_removed"])
        items.append(f"{n} Mode{'' if n == 1 else 's'} removed: {', '.join(m['modes_removed'])}")
    items += [f"{c['mode']}: {', '.join(c['fields'])} changed" for c in m["modes_changed"]]
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


def change_notes(old: dict, new: dict) -> dict:
    """The major changes from snapshot `old` to snapshot `new` ({} for none):
    {"added": [...], "removed": [...], "updated": [...]}, each entry with
    its kind (Platform, Emitter, Dwell file), name and what it holds or what
    changed."""
    old_platforms, old_emitters, _ = _collect(old)
    new_platforms, new_emitters, _ = _collect(new)
    added: list[dict] = []
    removed: list[dict] = []
    updated: list[dict] = []

    for pid in new_platforms.keys() - old_platforms.keys():
        p = new_platforms[pid]
        n = len(p["emitters"])
        added.append({"kind": "Platform", "name": p["name"], "detail": f"{n} Emitter{'' if n == 1 else 's'}"})
    for pid in old_platforms.keys() - new_platforms.keys():
        removed.append({"kind": "Platform", "name": old_platforms[pid]["name"], "detail": None})

    for eid in new_emitters.keys() - old_emitters.keys():
        e = new_emitters[eid]
        n = len(_modes(e["snapshot"]))
        added.append(
            {"kind": "Emitter", "name": _emitter_label(e), "detail": f"on {', '.join(sorted(e['platforms']))} · {n} Mode{'' if n == 1 else 's'}"}
        )
    for eid in old_emitters.keys() - new_emitters.keys():
        removed.append({"kind": "Emitter", "name": _emitter_label(old_emitters[eid]), "detail": None})
    for eid in old_emitters.keys() & new_emitters.keys():
        modes = _mode_changes(old_emitters[eid]["snapshot"], new_emitters[eid]["snapshot"])
        if modes:
            updated.append({"kind": "Emitter", "name": _emitter_label(new_emitters[eid]), **modes, "items": _mode_items(modes)})

    # A Platform both sides have: Emitters moved onto or off it (when the
    # Emitter itself stays in the MDF — otherwise it's listed as added/removed).
    for pid in old_platforms.keys() & new_platforms.keys():
        before, after = old_platforms[pid]["emitters"], new_platforms[pid]["emitters"]
        items = [f"Now carries {after[e]}" for e in sorted(after.keys() - before.keys(), key=lambda e: after[e].lower()) if e in old_emitters]
        items += [f"No longer carries {before[e]}" for e in sorted(before.keys() - after.keys(), key=lambda e: before[e].lower()) if e in new_emitters]
        if items:
            updated.append({"kind": "Platform", "name": new_platforms[pid]["name"], "items": items})

    old_dwell, new_dwell = _dwell_files(old), _dwell_files(new)
    for fid in new_dwell.keys() - old_dwell.keys():
        added.append({"kind": "Dwell file", "name": new_dwell[fid]["name"], "detail": None})
    for fid in old_dwell.keys() - new_dwell.keys():
        removed.append({"kind": "Dwell file", "name": old_dwell[fid]["name"], "detail": None})
    for fid in old_dwell.keys() & new_dwell.keys():
        items = _dwell_changes(old_dwell[fid], new_dwell[fid])
        if items:
            updated.append({"kind": "Dwell file", "name": new_dwell[fid]["name"], "items": items})

    return {"added": _by_name(added), "removed": _by_name(removed), "updated": _by_name(updated)}
