"""An operational mode's plan — several planned RF, PRI and PW values, a PRI
that dwells and switches — comments on it, and Modes made from its cartesian
product. For analysis: nothing about how Modes are made otherwise changes."""

from tests.integration.test_operational_modes_api import _emitter, _mode


def test_a_plan_with_several_values_and_a_dwell_and_switch(editor_client):
    e, _g, _s = _emitter(editor_client)
    url = f"/emitters/{e['id']}/operational-modes"
    plan = {
        "rf": [{"min": 9400, "max": 9450, "note": "datasheet"}],
        "pri": [{"min": 100, "dwell_pulses": 64}, {"min": 120, "dwell_ms": 20}, {"min": 150}],
        "pri_dwell_switch": True,
        "pw": [{"min": 1}, {"min": 2}],
    }
    track = editor_client.post(url, json={"name": "TRACK", "plan": plan}).json()
    assert track["plan"]["pri"][0] == {"min": 100, "dwell_pulses": 64}
    assert track["plan"]["rf"][0]["note"] == "datasheet"
    bad = [
        {"pri": [{"min": 100}], "pri_dwell_switch": True},  # one PRI isn't a dwell & switch
        {"pri": [{"min": 100, "dwell_pulses": 4}, {"min": 120}]},  # a dwell, not marked as one
        {"pri": [{"min": 100, "dwell_pulses": 4, "dwell_ms": 3}, {"min": 120}], "pri_dwell_switch": True},
        {"rf": [{"min": 9450, "max": 9400}]},
    ]
    for p in bad:
        assert editor_client.patch(f"{url}/{track['id']}", json={"plan": p}).status_code == 422, p
    # Empty: nothing planned.
    assert editor_client.patch(f"{url}/{track['id']}", json={"plan": {"rf": []}}).json()["plan"] is None
    editor_client.patch(f"{url}/{track['id']}", json={"plan": plan})
    v1 = editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"}).json()
    editor_client.patch(f"{url}/{track['id']}", json={"plan": {**plan, "pw": [{"min": 1}]}})
    v2 = editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v2"}).json()
    diff = editor_client.get(f"/emitters/{e['id']}/versions/{v2['version_number']}/diff").json()["entries"]
    [d] = [d for d in diff if d["label"] == "Plan"]
    assert d["old_value"].endswith("PW 1 µs / 2 µs") and "PRI (dwell & switch) 100 µs × 64 pulses / 120 µs × 20 ms / 150 µs" in d["new_value"]
    editor_client.post(f"/emitters/{e['id']}/versions/{v1['version_number']}/revert")
    assert len(editor_client.get(url).json()[0]["plan"]["pw"]) == 2


def test_modes_from_the_cartesian_product(editor_client):
    e, g, s = _emitter(editor_client)
    url = f"/emitters/{e['id']}/operational-modes"
    track = editor_client.post(url, json={"name": "TRACK"}).json()
    combos = [
        {"rf_min_mhz": 9400, "rf_max_mhz": 9450, "pri_min_us": pri, "pri_max_us": pri, "pw_min_us": pw, "pw_max_us": pw}
        for pri in (100, 120)
        for pw in (1, 2)
    ]
    _mode(editor_client, g, s, "Track 1")  # the name's taken: the next one is used
    r = editor_client.post(
        f"{url}/{track['id']}/generate",
        json={"ew_group_id": g["id"], "source_id": s["id"], "name_prefix": "Track", "combinations": combos},
    )
    assert r.status_code == 201 and r.json()["count"] == 4, r.text
    made = {m["name"]: m for m in editor_client.get(f"/ew-groups/{g['id']}/modes").json() if m["operational_mode_id"] == track["id"]}
    assert sorted(made) == ["Track 2", "Track 3", "Track 4", "Track 5"]
    assert {(m["line"]["pri_min_us"], m["line"]["pw_min_us"]) for m in made.values()} == {(100, 1), (100, 2), (120, 1), (120, 2)}
    assert len({m["generation_batch_id"] for m in made.values()}) == 1
    # One bad combination: nothing is made.
    r = editor_client.post(
        f"{url}/{track['id']}/generate",
        json={"ew_group_id": g["id"], "source_id": s["id"], "name_prefix": "X", "combinations": [{**combos[0], "rf_max_mhz": 1}]},
    )
    assert r.status_code == 422
    assert not [m for m in editor_client.get(f"/ew-groups/{g['id']}/modes").json() if m["name"].startswith("X ")]


def test_comments_threads_replies_resolved(editor_client, admin_client):
    e, _g, _s = _emitter(editor_client)
    url = f"/emitters/{e['id']}/operational-modes"
    track = editor_client.post(url, json={"name": "TRACK"}).json()
    c = f"/emitters/{e['id']}/plan-comments"
    first = editor_client.post(c, json={"body": "Is Track 3 really 150 µs?", "operational_mode_id": track["id"]}).json()
    assert (first["operational_mode_name"], first["resolved"]) == ("TRACK", False)
    reply = editor_client.post(c, json={"body": "Yes — range day 4", "parent_id": first["id"]}).json()
    assert reply["operational_mode_id"] == track["id"]
    # No replies to replies.
    assert editor_client.post(c, json={"body": "x", "parent_id": reply["id"]}).status_code == 422
    plan_wide = editor_client.post(c, json={"body": "Plan from the 2026 datasheet"}).json()
    assert plan_wide["operational_mode_id"] is None
    r = editor_client.patch(f"{c}/{first['id']}", json={"resolved": True})
    assert r.json()["resolved"] and r.json()["resolved_by_username"]
    assert editor_client.patch(f"{c}/{reply['id']}", json={"resolved": True}).status_code == 422
    # Someone else can't change your text, but an admin can delete it.
    assert admin_client.patch(f"{c}/{first['id']}", json={"body": "changed"}).status_code == 403
    edited = editor_client.patch(f"{c}/{first['id']}", json={"body": "Is Track 3 150 µs?"}).json()
    assert edited["edited_at"]
    assert admin_client.delete(f"{c}/{plan_wide['id']}").status_code == 204
    # Comments stay when their operational mode goes, saying what they were about.
    assert editor_client.delete(f"{url}/{track['id']}").status_code == 204
    rows = editor_client.get(c).json()
    assert [(x["operational_mode_id"], x["operational_mode_name"]) for x in rows] == [(None, "TRACK"), (None, "TRACK")]


def test_a_stagger_plan_and_pw_paired_with_pri(editor_client):
    e, g, s = _emitter(editor_client)
    url = f"/emitters/{e['id']}/operational-modes"
    plan = {
        "rf": [{"min": 9400, "max": 9450}],
        "pri_stagger": [{"steps": [300, 400, 500], "frame_time_delta_us": 2, "pw_steps": [1, 2, 1]}],
        "pri_pw_paired": True,
    }
    burst = editor_client.post(url, json={"name": "BURST", "plan": plan})
    assert burst.status_code == 201, burst.text
    assert burst.json()["plan"]["pri_stagger"][0]["pw_steps"] == [1, 2, 1]
    bad = [
        {**plan, "pri": [{"min": 100}]},  # values and staggers both
        {**plan, "pri_stagger": [{"steps": [300, 400], "pw_steps": [1]}]},  # a PW short
        {**plan, "pw": [{"min": 1}]},  # paired, yet a PW of its own
        {"pri": [{"min": 100, "pw_min": 1}]},  # a PRI's PW, not paired
        {"pri": [{"min": 100}, {"min": 120, "pw_min": 2}], "pri_pw_paired": True},  # one PRI without its PW
        {"pri_stagger": [{"steps": [300]}]},  # one step isn't a stagger
    ]
    for p in bad:
        assert editor_client.patch(f"{url}/{burst.json()['id']}", json={"plan": p}).status_code == 422, p
    paired = {"pri": [{"min": 100, "pw_min": 1}, {"min": 120, "pw_min": 2, "pw_max": 3}], "pri_pw_paired": True}
    assert editor_client.patch(f"{url}/{burst.json()['id']}", json={"plan": paired}).status_code == 200

    # A Stagger Mode made from a planned stagger; a Fixed one beside it.
    combos = [
        {"rf_min_mhz": 9400, "rf_max_mhz": 9450, "pri_stagger_values_us": [300, 400, 500], "frame_time_delta_us": 2, "pw_min_us": 1, "pw_max_us": 2},
        {"rf_min_mhz": 9400, "rf_max_mhz": 9450, "pri_min_us": 100, "pri_max_us": 100, "pw_min_us": 1, "pw_max_us": 1},
    ]
    r = editor_client.post(
        f"{url}/{burst.json()['id']}/generate",
        json={"ew_group_id": g["id"], "source_id": s["id"], "name_prefix": "Burst", "combinations": combos},
    )
    assert r.status_code == 201, r.text
    made = {m["name"]: m for m in editor_client.get(f"/ew-groups/{g['id']}/modes").json()}
    assert made["Burst 1"]["pri_type"] == "stagger" and made["Burst 1"]["line"]["pri_stagger_values_us"] == [300, 400, 500]
    assert made["Burst 1"]["line"]["frame_time_delta_us"] == 2
    assert made["Burst 2"]["pri_type"] == "fixed"
    # A combination is a PRI range or a stagger — not both, not neither.
    both = {**combos[1], "pri_stagger_values_us": [300, 400]}
    r = editor_client.post(
        f"{url}/{burst.json()['id']}/generate",
        json={"ew_group_id": g["id"], "source_id": s["id"], "name_prefix": "X", "combinations": [both]},
    )
    assert r.status_code == 422
