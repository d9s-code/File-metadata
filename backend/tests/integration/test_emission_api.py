"""What a radar transmits over time: a Mode's pulse groups (N pulses, then
off), an operational mode's timeline of pulse groups and off times and its
on/off periods, a scan's blanked sectors — checked, given to the planner,
saved with the Emitter's versions, compared, reverted and duplicated."""

from tests.integration.test_emitter_scans_api import _coverage, _emitter, _mode


def test_pulse_groups_on_a_mode_are_both_or_neither(editor_client):
    _e, g, s = _emitter(editor_client)
    m = _mode(editor_client, g, s, "Burst", group_pulses=8, group_off_ms=2)
    assert (m["group_pulses"], m["group_off_ms"]) == (8, 2)
    url = f"/ew-groups/{g['id']}/modes/{m['id']}"
    assert editor_client.patch(url, json={"group_pulses": None}).status_code == 422
    r = editor_client.patch(url, json={"group_pulses": None, "group_off_ms": None})
    assert r.status_code == 200 and r.json()["group_pulses"] is None, r.text
    bad = editor_client.post(
        f"/ew-groups/{g['id']}/modes",
        json={"source_id": s["id"], "name": "Half", "pri_type": "fixed", "line": m["line"] | {}, "group_pulses": 4},
    )
    assert bad.status_code == 422


def test_an_operational_modes_timeline_and_on_off_reach_the_planner(editor_client):
    e, g, s = _emitter(editor_client)
    a = _mode(editor_client, g, s, "PRF A")
    b = _mode(editor_client, g, s, "PRF B")
    lone = _mode(editor_client, g, s, "Lone")
    url = f"/emitters/{e['id']}/operational-modes"
    timeline = [
        {"kind": "group", "mode_id": a["id"], "pulses": 8},
        {"kind": "group", "mode_id": b["id"], "ms": 5},
        {"kind": "off", "ms": 2},
    ]
    r = editor_client.post(url, json={"name": "TRACK", "emission": {"timeline": timeline, "on_s": 2, "off_s": 8}})
    assert r.status_code == 201, r.text
    track = r.json()
    assert track["emission"]["on_s"] == 2 and len(track["emission"]["timeline"]) == 3
    child = editor_client.post(url, json={"name": "Track 1", "parent_id": track["id"]}).json()
    editor_client.patch(f"/ew-groups/{g['id']}/modes/{a['id']}", json={"operational_mode_id": child["id"]})
    editor_client.patch(f"/ew-groups/{g['id']}/modes/{lone['id']}", json={"operational_mode_id": child["id"]})

    # Checked: a group needs its Mode and pulses or a time; an off time only a time; both on and off.
    for bad in (
        {"timeline": [{"kind": "group", "pulses": 8}]},
        {"timeline": [{"kind": "group", "mode_id": a["id"], "pulses": 8, "ms": 3}]},
        {"timeline": [{"kind": "off", "ms": 2, "pulses": 3}]},
        {"timeline": [{"kind": "off", "ms": 2}]},
        {"on_s": 2},
    ):
        assert editor_client.patch(f"{url}/{track['id']}", json={"emission": bad}).status_code == 422, bad
    _other, og, os_ = _emitter(editor_client, "Other")
    foreign = _mode(editor_client, og, os_, "F")
    r = editor_client.patch(f"{url}/{track['id']}", json={"emission": {"timeline": [{"kind": "group", "mode_id": foreign["id"], "pulses": 2}]}})
    assert r.status_code == 404

    _v, plan = _coverage(editor_client, e, "Emission")
    # PRF A is in TRACK's timeline: each step resolved, its own marked; on/off from TRACK, through Track 1.
    steps = plan["PRF A"]["timeline"]["steps"]
    assert [(x["kind"], x.get("mode_name"), x.get("own")) for x in steps] == [
        ("group", "PRF A", True), ("group", "PRF B", False), ("off", None, None)]  # fmt: skip
    assert steps[0]["pulses"] == 8 and steps[0]["steps_us"] == [1001]  # its longest gap, with the delta and steps[1]["ms"] == 5
    assert (plan["PRF A"]["on_off_s"], plan["PRF A"]["on_off_from"]) == ([2, 8], "TRACK")
    # PRF B isn't under TRACK, but TRACK's timeline names it; Lone is under it but not in the timeline.
    assert plan["PRF B"]["timeline"]["operational_mode"] == "TRACK" and plan["PRF B"]["on_off_s"] is None
    assert (plan["Lone"]["timeline"], plan["Lone"]["on_off_s"]) == (None, [2, 8])

    # Cleared: null.
    r = editor_client.patch(f"{url}/{track['id']}", json={"emission": {"timeline": []}})
    assert r.status_code == 200 and r.json()["emission"] is None


def test_blanked_sectors_on_a_scan(editor_client):
    e, _g, _s = _emitter(editor_client)
    url = f"/emitters/{e['id']}/scans"
    r = editor_client.post(
        url,
        json={
            "name": "Rotate",
            "pattern": "circular",
            "params": {"period_s": 10},
            "beam_az_deg": 2,
            "blanked_sectors": [{"from_deg": 350, "to_deg": 10}],
        },
    )
    assert r.status_code == 201 and r.json()["blanked_sectors"] == [{"from_deg": 350, "to_deg": 10}], r.text
    scan = r.json()
    assert editor_client.patch(f"{url}/{scan['id']}", json={"blanked_sectors": [{"from_deg": 5, "to_deg": 5}]}).status_code == 422
    assert editor_client.patch(f"{url}/{scan['id']}", json={"blanked_sectors": [{"from_deg": 5, "to_deg": 400}]}).status_code == 422
    r = editor_client.patch(f"{url}/{scan['id']}", json={"blanked_sectors": []})
    assert r.status_code == 200 and r.json()["blanked_sectors"] is None


def test_versioned_compared_reverted_and_duplicated(editor_client):
    e, g, s = _emitter(editor_client)
    a = _mode(editor_client, g, s, "A", group_pulses=8, group_off_ms=2)
    scan = editor_client.post(f"/emitters/{e['id']}/scans", json={"name": "R", "pattern": "circular", "params": {"period_s": 10}}).json()
    url = f"/emitters/{e['id']}/operational-modes"
    op = editor_client.post(url, json={"name": "TRACK", "emission": {"timeline": [{"kind": "group", "mode_id": a["id"], "pulses": 8}]}}).json()
    v1 = editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"}).json()

    editor_client.patch(f"/ew-groups/{g['id']}/modes/{a['id']}", json={"group_pulses": 16})
    editor_client.patch(f"{url}/{op['id']}", json={"emission": {
        "timeline": [{"kind": "group", "mode_id": a["id"], "pulses": 8}, {"kind": "off", "ms": 3}], "on_s": 1, "off_s": 4}})  # fmt: skip
    editor_client.patch(f"/emitters/{e['id']}/scans/{scan['id']}", json={"blanked_sectors": [{"from_deg": 90, "to_deg": 120}]})
    v2 = editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v2"}).json()
    diff = editor_client.get(f"/emitters/{e['id']}/versions/{v2['version_number']}/diff").json()["entries"]
    seen = {(d["scope"], d["label"], d["old_value"], d["new_value"]) for d in diff}
    assert ("Mode 'A'", "Pulses per group", 8, 16) in seen
    assert ("Operational mode 'TRACK'", "Emission", "A × 8 pulses", "A × 8 pulses, off 3 ms · on 1 s, off 4 s") in seen
    assert ("Scan 'R'", "Blanked sectors", None, "90–120°") in seen

    assert editor_client.post(f"/emitters/{e['id']}/versions/{v1['version_number']}/revert").status_code == 200
    assert editor_client.get(url).json()[0]["emission"] == {"timeline": [{"kind": "group", "mode_id": a["id"], "pulses": 8}]}
    assert next(m for m in editor_client.get(f"/ew-groups/{g['id']}/modes").json() if m["id"] == a["id"])["group_pulses"] == 8
    assert editor_client.get(f"/emitters/{e['id']}/scans").json()[0]["blanked_sectors"] is None

    # A duplicate's timeline names its own copy of A.
    copy = editor_client.post(f"/emitters/{e['id']}/duplicate", json={"new_name": "MFR copy"}).json()
    [copy_group] = editor_client.get(f"/emitters/{copy['id']}/ew-groups").json()
    [copy_a] = editor_client.get(f"/ew-groups/{copy_group['id']}/modes").json()
    [copy_op] = editor_client.get(f"/emitters/{copy['id']}/operational-modes").json()
    assert copy_op["emission"]["timeline"][0]["mode_id"] == copy_a["id"] != a["id"]
    assert copy_a["group_pulses"] == 8
