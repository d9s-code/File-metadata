"""What the dwell planner reads of a Platform's pinned Modes: the longest gap
between pulses, a stagger's frame, its EW Group's scan period (s, with its
delta), priority and confirmation — beside the RF the coverage already gives.
A Mode's scan: test_emitter_scans_api."""

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
    # No scan of its own: the planner falls back on the EW Group's range.
    assert (modes["Fixed"]["scan"], modes["Fixed"]["scan_from"], modes["Fixed"]["group_scan_s"]) == (None, None, [1.9, 2.6])
    # The average gap between pulses, for an ESA dwell's length.
    assert (modes["Fixed"]["mean_interval_us"], modes["Stag"]["mean_interval_us"]) == (995, 400)
    assert emitter["illumination_time_ms"] is None
