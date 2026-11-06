"""Change notes: only the major changes between two MDF snapshots."""

import copy

from app.services.change_notes import change_notes


def _mode(mid, name, **line):
    base = {"rf_min_mhz": 3000, "rf_max_mhz": 3100, "rf_delta": 0, "pw_min_us": 1, "pw_max_us": 2, "pw_delta": 0,
            "pri_min_us": 900, "pri_max_us": 1000, "pri_delta": 0, "jitter_min_us": 0, "jitter_max_us": 1,
            "rf_range_matching": False}
    return {"id": mid, "name": name, "pri_type": "fixed", "confirmation_quality": 100, "confirmation_quantity": 2,
            "notes": None, "line": base | line}


def _emitter(name, modes, designation=None, threat_priority=5, ageout=10, scan_max=1):
    return {"name": name, "designation": designation,
            "ew_groups": [{"name": "G", "threat_priority": threat_priority, "ageout": ageout, "scan_min": 0, "scan_max": scan_max, "modes": modes}]}


def _mdf(platforms, dwell_files=()):
    """platforms: [(platform id, name, version, [(emitter id, version, emitter snapshot)])]"""
    return {
        "links": [
            {"platform_id": pid, "platform_name": pname, "platform_version_number": pv,
             "platform_snapshot": {"name": pname, "links": [
                 {"emitter_id": eid, "emitter_name": es["name"], "emitter_version_number": ev, "emitter_snapshot": es}
                 for eid, ev, es in emitters
             ]}}
            for pid, pname, pv, emitters in platforms
        ],
        "dwell_files": list(dwell_files),
    }


RADAR = _emitter("Sea Search", [_mode("m1", "Search"), _mode("m2", "Track")], designation="SS-1")


def test_nothing_exported_changed_is_no_change():
    old = _mdf([("p1", "Frigate", 1, [("e1", 1, RADAR)])])
    later = copy.deepcopy(RADAR)
    # New versions of the Emitter and the Platform, but only notes, confirmation,
    # scan period and range matching changed — none of which count.
    later["ew_groups"][0]["modes"][0]["notes"] = "Checked again"
    later["ew_groups"][0]["modes"][0]["confirmation_quality"] = 80
    later["ew_groups"][0]["modes"][0]["line"]["rf_range_matching"] = True
    later["ew_groups"][0]["scan_max"] = 2
    new = _mdf([("p1", "Frigate", 2, [("e1", 2, later)])])
    assert change_notes(old, new) == {"added": [], "removed": [], "updated": []}


def test_mode_values_that_count():
    old = _mdf([("p1", "Frigate", 1, [("e1", 1, RADAR)])])
    later = copy.deepcopy(RADAR)
    modes = later["ew_groups"][0]["modes"]
    modes[0]["line"]["rf_delta"] = 1  # delta only: the exported RF range moves
    modes[1]["name"] = "Track Fine"  # renamed
    modes.append(_mode("m3", "Acquire"))
    later["ew_groups"][0]["threat_priority"] = 9
    new = _mdf([("p1", "Frigate", 2, [("e1", 2, later)])])
    notes = change_notes(old, new)
    [emitter] = notes["updated"]
    assert emitter["name"] == "SS-1 — Sea Search"
    assert emitter["modes_added"] == ["Acquire"] and emitter["modes_removed"] == []
    assert emitter["modes_changed"] == [
        {"mode": "Search", "fields": ["RF", "Threat priority"]},
        {"mode": "Track → Track Fine", "fields": ["Name", "Threat priority"]},
    ]
    assert emitter["items"] == [
        "1 Mode added: Acquire",
        "Search: RF, Threat priority changed",
        "Track → Track Fine: Name, Threat priority changed",
    ]


def test_pri_type_and_stagger():
    stagger = _mode("m1", "Search")
    stagger["pri_type"] = "stagger"
    stagger["line"] |= {"pri_stagger_values_us": [700, 750], "frame_time_delta_us": 0}
    old = _mdf([("p1", "Frigate", 1, [("e1", 1, _emitter("R", [stagger]))])])
    longer = copy.deepcopy(stagger)
    longer["line"]["frame_time_delta_us"] = 3  # the exported frame time widens
    fixed = copy.deepcopy(stagger)
    fixed["pri_type"] = "fixed"
    assert change_notes(old, _mdf([("p1", "Frigate", 2, [("e1", 2, _emitter("R", [longer]))])]))["updated"][0]["modes_changed"] == [
        {"mode": "Search", "fields": ["Stagger"]}
    ]
    # A PRI type change is one change, not also PRI and stagger.
    assert change_notes(old, _mdf([("p1", "Frigate", 2, [("e1", 2, _emitter("R", [fixed]))])]))["updated"][0]["modes_changed"] == [
        {"mode": "Search", "fields": ["PRI type"]}
    ]


def test_platforms_and_emitters_in_and_out():
    nav = _emitter("Nav Radar", [_mode("n1", "Nav")])
    old = _mdf([("p1", "Frigate", 1, [("e1", 1, RADAR)]), ("p2", "Old Tug", 1, [("e3", 1, _emitter("Tug Radar", []))])])
    new = _mdf([
        ("p1", "Frigate", 1, [("e1", 1, RADAR)]),
        ("p3", "Patrol Boat", 1, [("e1", 1, RADAR), ("e2", 1, nav)]),
    ])
    notes = change_notes(old, new)
    assert [(e["kind"], e["name"], e["detail"]) for e in notes["added"]] == [
        ("Platform", "Patrol Boat", "2 Emitters"),
        ("Emitter", "Nav Radar", "on Patrol Boat · 1 Mode"),
    ]
    assert [(e["kind"], e["name"]) for e in notes["removed"]] == [("Platform", "Old Tug"), ("Emitter", "Tug Radar")]
    # Sea Search is on a new Platform, but the Emitter itself is unchanged.
    assert notes["updated"] == []


def test_an_emitter_moving_between_platforms_that_stay():
    old = _mdf([("p1", "Frigate", 1, [("e1", 1, RADAR)]), ("p2", "Tug", 1, [])])
    new = _mdf([("p1", "Frigate", 2, []), ("p2", "Tug", 2, [("e1", 1, RADAR)])])
    notes = change_notes(old, new)
    assert notes["added"] == [] and notes["removed"] == []
    assert [(u["name"], u["items"]) for u in notes["updated"]] == [
        ("Frigate", ["No longer carries Sea Search"]),
        ("Tug", ["Now carries Sea Search"]),
    ]


def _dwell(fid, name, dwells, notes=None, timeout=5):
    return {"dwell_file_id": fid, "name": name, "version_number": 1,
            "snapshot": {"name": name, "timeout": timeout, "setup_time": 5, "notes": notes, "strategies": [
                {"strategy_id": "s1", "strategy_version_id": "sv1", "strategy_version_number": 1,
                 "snapshot": {"name": "North", "dwells": dwells, "manual_collect_time_ms": 50, "rapid_df": None, "split_mode": None,
                              "platform_ids": [], "platform_names": [], "description": None}}]}}


def test_dwell_files():
    dwells = [{"freq_mhz": 3000, "dwell_time_ms": 10, "collect_time_ms": 5}]
    old = _mdf([], [_dwell("d1", "Northern", dwells), _dwell("d2", "Old", dwells)])
    notes_only = _mdf([], [_dwell("d1", "Northern", dwells, notes="tidied"), _dwell("d2", "Old", dwells)])
    assert change_notes(old, notes_only) == {"added": [], "removed": [], "updated": []}
    changed = _mdf([], [_dwell("d1", "Northern", dwells + [dict(dwells[0], freq_mhz=9000)]), _dwell("d3", "New", dwells)])
    notes = change_notes(old, changed)
    assert [(e["kind"], e["name"]) for e in notes["added"]] == [("Dwell file", "New")]
    assert [(e["kind"], e["name"]) for e in notes["removed"]] == [("Dwell file", "Old")]
    assert notes["updated"] == [{"kind": "Dwell file", "name": "Northern", "items": ["Strategy North: dwells changed"]}]


def test_what_counts_can_be_switched():
    old = _mdf([("p1", "Frigate", 1, [("e1", 1, RADAR)])], [_dwell("d1", "Northern", [])])
    later = copy.deepcopy(RADAR)
    modes = later["ew_groups"][0]["modes"]
    modes[0]["confirmation_quality"] = 80  # off by default
    modes[1]["line"]["rf_delta"] = 1  # delta only
    modes.append(_mode("m3", "Acquire"))
    new = _mdf([("p1", "Frigate", 2, [("e1", 2, later)]), ("p2", "Tug", 1, [])], [_dwell("d1", "Northern", [])])

    def changed(**counts):
        notes = change_notes(old, new, counts)
        return notes, {c["mode"]: c["fields"] for u in notes["updated"] for c in u.get("modes_changed", [])}

    notes, fields = changed()
    assert fields == {"Track": ["RF"]} and notes["updated"][0]["modes_added"] == ["Acquire"]
    assert [a["name"] for a in notes["added"]] == ["Tug"]
    # Confirmation on: it's listed. Deltas off: the delta-only RF change isn't.
    assert changed(confirmation=True, deltas=False)[1] == {"Search": ["Confirmation"]}
    # Whole lists off: no Platforms or Modes added, and no RF either.
    notes, fields = changed(platforms=False, modes=False, rf=False)
    assert notes == {"added": [], "removed": [], "updated": []}
    # Unknown rules are ignored.
    assert change_notes(old, new, {"nonsense": True}) == change_notes(old, new)
