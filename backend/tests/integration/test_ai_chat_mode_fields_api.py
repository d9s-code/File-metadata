"""The AI chat can write a Mode in every way the Mode form can — several
Sources, any PRI type, range matching, an explicit frame time, confirmation,
test-derived links, the Admin defaults for what it leaves out — and change
every one of those on an existing Mode: its Sources, EW Group, PRI type, a
stagger's steps and the rest. Still only ever by the user adding or applying."""

from tests.integration.test_ai_review_api import fake_llm  # noqa: F401  (fixture)
from tests.integration.test_ambiguity_api import emitter_with_two_overlapping_modes  # noqa: F401


def _setup(client, admin_client, emitter_with_two_overlapping_modes):  # noqa: F811
    eid = emitter_with_two_overlapping_modes["emitter"]["id"]
    client.post(f"/emitters/{eid}/checkout")
    client.post(f"/emitters/{eid}/sources", json={"name": "Source B", "source_date": "2025-02-01"})
    client.post(f"/emitters/{eid}/ew-groups", json={"name": "Group B"})
    resp = client.post(
        f"/emitters/{eid}/test-records",
        json={"test_type": "simulation", "title": "Range day 9", "received_power_dbfs": -40, "test_date": "2026-09-01",
              "simulation_created_date": "2026-08-01", "result": "partial"},
    )  # fmt: skip
    assert resp.status_code == 201, resp.text
    run = resp.json()
    # The Admin defaults the form starts with.
    defaults = admin_client.get("/settings").json()["mode_defaults"]
    admin_client.patch("/settings", json={"mode_defaults": {**defaults, "rf_delta": 1.5, "pw_delta": 0.1, "frame_time_delta_us": 4}})
    return eid, run


def _modes(client, eid):
    return {m["name"]: m for m in client.get(f"/emitters/{eid}/modes").json()}


def test_a_proposed_mode_sets_whatever_the_form_can(editor_client, admin_client, fake_llm, emitter_with_two_overlapping_modes):  # noqa: F811
    eid, run = _setup(editor_client, admin_client, emitter_with_two_overlapping_modes)
    fake_llm.replies = [
        {"action": "propose_modes", "modes": [
            {"emitter": "Ambiguity Emitter", "ew_group": "Group B", "sources": ["Source B", "Source A"], "name": "Track 1",
             "pri_type": "stagger", "rf_min_mhz": 9400, "rf_max_mhz": 9420, "pw_min_us": 0.5, "pw_max_us": 0.7,
             "stagger_us": [100, 120, 140], "explicit_frame_time_us": 365, "pri_range_matching": True, "rf_range_matching": True,
             "confirmation_quality": 80, "confirmation_quantity": 3, "derived_from_tests": ["Range day 9"], "notes": "From the range"},
            {"emitter": "Ambiguity Emitter", "ew_group": "Group A", "name": "Odd 1", "source": "Source A", "pri_type": "xlet",
             "rf_min_mhz": 5000, "pw_min_us": 1},
            {"emitter": "Ambiguity Emitter", "ew_group": "Group A", "name": "CW 1", "source": "Source A", "pri_type": "cw", "rf_min_mhz": 5000},
        ]},
        {"action": "answer", "answer": "Proposed."},
    ]  # fmt: skip
    chat = editor_client.post("/ai/chats", json={"content": "Write them"}).json()
    track, odd, cw = chat["messages"][1]["reply"]["proposals"]
    assert track["problem"] is None, track["problem"]
    assert track["source_names"] == ["Source B", "Source A"] and track["derived_test_titles"] == ["Range day 9"]
    assert (track["confirmation_quality"], track["confirmation_quantity"]) == (80, 3)
    # Deltas left out come from the Admin defaults.
    assert (track["line"]["rf_delta"], track["line"]["pw_delta"], track["line"]["frame_time_delta_us"]) == (1.5, 0.1, 4)
    assert track["line"]["explicit_frame_time_us"] == 365 and track["line"]["pri_range_matching"] is True
    assert odd["problem"] is None and odd["pri_type"] == "xlet"
    assert "needs a PW" in cw["problem"]

    resp = editor_client.post(f"/ai/chats/{chat['id']}/proposals/apply", json={"message_index": 1, "proposal_ids": [track["id"], odd["id"]]})
    assert resp.status_code == 200, resp.text
    made = _modes(editor_client, eid)["Track 1"]
    assert made["source_names"] == ["Source B", "Source A"]
    assert (made["confirmation_quality"], made["confirmation_quantity"]) == (80, 3)
    assert made["line"]["explicit_frame_time_us"] == 365 and made["line"]["rf_range_matching"] is True
    assert [r["id"] for r in made["derived_from_test_records"]] == [run["id"]]


def test_an_edit_changes_sources_group_pri_type_steps_and_the_rest(editor_client, admin_client, fake_llm, emitter_with_two_overlapping_modes):  # noqa: F811
    eid, run = _setup(editor_client, admin_client, emitter_with_two_overlapping_modes)
    fake_llm.replies = [
        {"action": "propose_mode_edits", "edits": [
            # Mode 1: another Source, another EW Group, a stagger instead of a fixed PRI.
            {"emitter": "Ambiguity Emitter", "mode": "Mode 1", "reason": "It's a stagger", "sources": ["Source B"],
             "move_to_ew_group": "Group B", "pri_type": "stagger", "stagger_us": [300, 350, 400],
             "confirmation_quality": 90, "derived_from_tests": ["Range day 9"]},
            # Mode 2: a Source added, then range matching and confirmation.
            {"emitter": "Ambiguity Emitter", "mode": "Mode 2", "add_sources": ["Source B"], "pw_range_matching": True,
             "confirmation_quantity": 4},
        ]},
        {"action": "answer", "answer": "Proposed."},
    ]  # fmt: skip
    chat = editor_client.post("/ai/chats", json={"content": "Change them"}).json()
    one, two = chat["messages"][1]["reply"]["edit_proposals"]
    assert one["problem"] is None, one["problem"]
    changed = {c["field"]: (c["old"], c["new"]) for c in one["changes"]}
    assert changed["sources"] == (["Source A"], ["Source B"])
    assert changed["ew_group"] == ("Group A", "Group B")
    assert changed["pri_type"] == ("fixed", "stagger")
    assert changed["pri_stagger_values_us"] == (None, [300, 350, 400])
    assert changed["pri_min_us"] == (800, None) and changed["frame_time_delta_us"] == (None, 4)
    assert changed["derived"] == (None, ["Range day 9"])
    assert {c["field"] for c in two["changes"]} == {"sources", "pw_range_matching", "confirmation_quantity"}

    resp = editor_client.post(f"/ai/chats/{chat['id']}/edit-proposals/apply", json={"message_index": 1, "edit_ids": [one["id"], two["id"]]})
    assert resp.status_code == 200, resp.text
    modes = _modes(editor_client, eid)
    m1, m2 = modes["Mode 1"], modes["Mode 2"]
    assert (m1["pri_type"], m1["line"]["pri_stagger_values_us"], m1["source_names"]) == ("stagger", [300, 350, 400], ["Source B"])
    assert m1["confirmation_quality"] == 90 and [r["id"] for r in m1["derived_from_test_records"]] == [run["id"]]
    groups = {g["id"]: g["name"] for g in editor_client.get(f"/emitters/{eid}/ew-groups").json()}
    assert groups[m1["ew_group_id"]] == "Group B"
    assert m2["source_names"] == ["Source A", "Source B"] and m2["line"]["pw_range_matching"] is True and m2["confirmation_quantity"] == 4
    log = editor_client.get("/audit-log", params={"emitter_id": eid, "entity_type": "mode"}).json()["items"]
    assert any(e["summary"] == "Updated Mode 'Mode 1' (test-derived: 'Range day 9') — proposed by the AI chat" for e in log)


def test_a_stagger_sequence_edit_and_a_stale_source(editor_client, admin_client, fake_llm, emitter_with_two_overlapping_modes):  # noqa: F811
    eid, _ = _setup(editor_client, admin_client, emitter_with_two_overlapping_modes)
    group = next(g for g in editor_client.get(f"/emitters/{eid}/ew-groups").json() if g["name"] == "Group A")
    sources = {s["name"]: s["id"] for s in editor_client.get(f"/emitters/{eid}/sources").json()}
    editor_client.post(f"/ew-groups/{group['id']}/modes", json={
        "source_id": sources["Source A"], "name": "Stag 1", "pri_type": "stagger",
        "line": {"rf_min_mhz": 9000, "rf_max_mhz": 9010, "pw_min_us": 1, "pw_max_us": 1, "rf_delta": 1, "pw_delta": 0.1,
                 "pri_stagger_values_us": [100, 200], "frame_time_delta_us": 3,
                 "rf_range_matching": False, "pw_range_matching": False, "pri_range_matching": False}})  # fmt: skip
    fake_llm.replies = [
        {"action": "propose_mode_edits", "edits": [
            {"emitter": "Ambiguity Emitter", "mode": "Stag 1", "stagger_us": [100, 150, 200], "explicit_frame_time_us": 460,
             "remove_sources": ["Source A"], "add_sources": ["Source B"]},
            {"emitter": "Ambiguity Emitter", "mode": "Mode 2", "remove_sources": ["Source A"]},
        ]},
        {"action": "answer", "answer": "Proposed."},
    ]  # fmt: skip
    chat = editor_client.post("/ai/chats", json={"content": "Three steps"}).json()
    stag, lonely = chat["messages"][1]["reply"]["edit_proposals"]
    assert stag["problem"] is None, stag["problem"]
    changed = {c["field"]: (c["old"], c["new"]) for c in stag["changes"]}
    assert changed["pri_stagger_values_us"] == ([100, 200], [100, 150, 200])
    assert changed["explicit_frame_time_us"] == (None, 460) and changed["sources"] == (["Source A"], ["Source B"])
    assert lonely["problem"] == "A Mode keeps at least one Source"

    # Someone changes its Sources first: the edit is refused.
    stag_mode = _modes(editor_client, eid)["Stag 1"]
    editor_client.patch(f"/ew-groups/{group['id']}/modes/{stag_mode['id']}", json={"source_ids": [sources["Source A"], sources["Source B"]]})
    resp = editor_client.post(f"/ai/chats/{chat['id']}/edit-proposals/apply", json={"message_index": 1, "edit_ids": [stag["id"]]})
    assert resp.status_code == 409 and "Sources" in resp.json()["detail"]
