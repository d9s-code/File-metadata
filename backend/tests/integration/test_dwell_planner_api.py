"""What the dwell planner reads of a Platform's pinned Modes: the longest gap
between pulses, a stagger's frame, its EW Group's scan period (s, with its
delta), priority and confirmation — beside the RF the coverage already gives."""

from tests.integration.test_platform_uniqueness_api import LINE


def test_the_coverage_carries_what_the_planner_needs(editor_client):
    e = editor_client.post("/emitters", json={"name": "Planner Radar"}).json()
    g = editor_client.post(
        f"/emitters/{e['id']}/ew-groups", json={"name": "Search", "scan_min": 2, "scan_max": 2.5, "scan_delta": 0.1, "threat_priority": 3}
    ).json()
    s = editor_client.post(f"/emitters/{e['id']}/sources", json={"name": "S", "source_date": "2026-01-01"}).json()
    fixed = {**LINE, "pri_min_us": 990, "pri_max_us": 1000, "pri_delta": 5, "jitter_min_us": 0, "jitter_max_us": 2}
    stagger = {k: v for k, v in LINE.items() if not k.startswith(("pri_", "jitter_"))} | {
        "pri_range_matching": False, "pri_stagger_values_us": [300, 400, 500], "frame_time_delta_us": 3}  # fmt: skip
    for name, pri_type, line in (("Fixed", "fixed", fixed), ("Stag", "stagger", stagger)):
        r = editor_client.post(f"/ew-groups/{g['id']}/modes", json={"source_id": s["id"], "name": name, "pri_type": pri_type, "line": line})
        assert r.status_code == 201, r.text
    v = editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"}).json()
    p = editor_client.post("/platforms", json={"name": "Planner Platform"}).json()
    editor_client.post(f"/platforms/{p['id']}/links", json={"emitter_id": e["id"], "emitter_version_id": v["id"]})

    [emitter] = editor_client.get(f"/platforms/{p['id']}/coverage").json()
    modes = {m["name"]: m["planner"] for m in emitter["modes"]}
    # Fixed: the longest PRI with its delta (1005) and its jitter (2).
    assert modes["Fixed"]["longest_interval_us"] == 1007
    assert modes["Fixed"]["scan_s"] == [1.9, 2.6]
    assert (modes["Fixed"]["priority"], modes["Fixed"]["confirmation_quantity"], modes["Fixed"]["group_name"]) == (3, 2, "Search")
    # Stagger: its longest step, and its frame (1200) with the frame delta.
    assert (modes["Stag"]["longest_interval_us"], modes["Stag"]["stagger_steps"], modes["Stag"]["frame_us"]) == (500, 3, 1203)
    assert (modes["Fixed"]["scan_from"], modes["Fixed"]["group_scan_s"]) == ("group", [1.9, 2.6])
    assert emitter["illumination_time_ms"] is None


def test_a_modes_own_scan_box_and_the_emitters_illumination_time(editor_client):
    """A Mode's function scans within its own box inside the EW Group's range;
    the planner uses it (with the group's delta). The Emitter's illumination
    time goes with it. Both are versioned, diffed and reverted like the rest."""
    e = editor_client.post("/emitters", json={"name": "Boxed Radar", "illumination_time_ms": 25}).json()
    assert e["illumination_time_ms"] == 25
    g = editor_client.post(
        f"/emitters/{e['id']}/ew-groups", json={"name": "Multi", "scan_min": 1, "scan_max": 10, "scan_delta": 0.1}
    ).json()
    s = editor_client.post(f"/emitters/{e['id']}/sources", json={"name": "S", "source_date": "2026-01-01"}).json()
    fixed = {**LINE, "pri_min_us": 990, "pri_max_us": 1000}
    r = editor_client.post(
        f"/ew-groups/{g['id']}/modes",
        json={"source_id": s["id"], "name": "Track", "pri_type": "fixed", "line": fixed, "scan_min_s": 1, "scan_max_s": 2},
    )
    assert r.status_code == 201, r.text
    mode = r.json()
    assert (mode["scan_min_s"], mode["scan_max_s"]) == (1, 2)
    plain = editor_client.post(
        f"/ew-groups/{g['id']}/modes", json={"source_id": s["id"], "name": "Search", "pri_type": "fixed", "line": fixed}
    ).json()
    # Half a box, or one upside down, isn't a box.
    for bad in ({"scan_min_s": 3}, {"scan_min_s": 3, "scan_max_s": 2}):
        r = editor_client.patch(f"/ew-groups/{g['id']}/modes/{plain['id']}", json=bad)
        assert r.status_code == 422, r.text
    r = editor_client.patch(f"/ew-groups/{g['id']}/modes/{mode['id']}", json={"scan_min_s": 5})
    assert r.status_code == 422, r.text
    v1 = editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"}).json()
    p = editor_client.post("/platforms", json={"name": "Boxed Platform"}).json()
    editor_client.post(f"/platforms/{p['id']}/links", json={"emitter_id": e["id"], "emitter_version_id": v1["id"]})

    [emitter] = editor_client.get(f"/platforms/{p['id']}/coverage").json()
    assert emitter["illumination_time_ms"] == 25
    modes = {m["name"]: m["planner"] for m in emitter["modes"]}
    assert (modes["Track"]["scan_s"], modes["Track"]["scan_from"], modes["Track"]["group_scan_s"]) == ([0.9, 2.1], "mode", [0.9, 10.1])
    assert (modes["Search"]["scan_s"], modes["Search"]["scan_from"]) == ([0.9, 10.1], "group")

    # Edited, they show in the diff; reverted, they come back.
    assert editor_client.patch(f"/ew-groups/{g['id']}/modes/{mode['id']}", json={"scan_min_s": None, "scan_max_s": None}).status_code == 200
    assert editor_client.patch(f"/emitters/{e['id']}", json={"illumination_time_ms": 40}).status_code == 200
    v2 = editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v2"}).json()
    diff = editor_client.get(f"/emitters/{e['id']}/versions/{v2['version_number']}/diff")
    assert diff.status_code == 200, diff.text
    labels = {d["label"] for d in diff.json()["entries"]}
    assert {"Illumination time (ms)", "Scan period min (s)", "Scan period max (s)"} <= labels
    r = editor_client.post(f"/emitters/{e['id']}/versions/{v1['version_number']}/revert")
    assert r.status_code == 200, r.text
    assert editor_client.get(f"/emitters/{e['id']}").json()["illumination_time_ms"] == 25
    back = next(m for m in editor_client.get(f"/ew-groups/{g['id']}/modes").json() if m["id"] == mode["id"])
    assert (back["scan_min_s"], back["scan_max_s"]) == (1, 2)
