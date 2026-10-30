"""The AI chat editing existing Modes — as with new Modes, only ever by the
user applying what it proposed: a preview of each value before → after,
checked like the Mode form's edit, all or none, refused if the Mode changed
since, into an Emitter the user is editing."""

from tests.integration.test_ai_review_api import fake_llm  # noqa: F401  (fixture)
from tests.integration.test_ambiguity_api import FIXED_LINE, emitter_with_two_overlapping_modes  # noqa: F401

EDITS = {
    "action": "propose_mode_edits",
    "edits": [
        {"emitter": "Ambiguity Emitter", "mode": "Mode 1", "reason": "Seen at 3120 MHz", "rf_max_mhz": 3120, "rf_delta": 2,
         "name": "Search 1"},
        # Same as it is: changes nothing.
        {"emitter": "Ambiguity Emitter", "mode": "Mode 2", "pri_min_us": 800},
        # A max below its min.
        {"emitter": "Ambiguity Emitter", "mode": "Mode 2", "ew_group": "Group A", "pw_max_us": 0.1},
        {"emitter": "Ambiguity Emitter", "mode": "Mode 9", "rf_min_mhz": 1},
    ],
}  # fmt: skip


def _modes(client, emitter_id):
    return {m["name"]: m for m in client.get(f"/emitters/{emitter_id}/modes").json()}


def test_proposed_edits_are_only_applied_when_the_user_applies_them(
    editor_client, fake_llm, emitter_with_two_overlapping_modes  # noqa: F811
):
    emitter_id = emitter_with_two_overlapping_modes["emitter"]["id"]
    fake_llm.replies = [EDITS, {"action": "answer", "answer": "I've proposed widening Mode 1 — apply it if it looks right."}]
    chat = editor_client.post("/ai/chats", json={"content": "Widen Mode 1 to 3120 MHz"}).json()
    answer = chat["messages"][-1]["reply"]
    ok, same, bad, missing = answer["edit_proposals"]
    assert (ok["mode_name"], ok["problem"], ok["status"], ok["reason"]) == ("Mode 1", None, "proposed", "Seen at 3120 MHz")
    assert [(c["field"], c["old"], c["new"]) for c in ok["changes"]] == [
        ("name", "Mode 1", "Search 1"), ("rf_max_mhz", 3100, 3120), ("rf_delta", 1, 2)
    ]
    assert ok["line"]["pri_max_us"] == 1200 and ok["dsl"] and ok["dsl_before"]
    assert "changes nothing" in same["problem"]
    assert bad["problem"] and "no Mode called" in missing["problem"]
    assert "only the user can apply them" in fake_llm.requests[1]["messages"][-1]["content"]
    assert answer["steps"][0]["args"] is None and answer["steps"][0]["label"] == "Proposed edits to 4 Modes for you to apply"
    # Nothing written yet.
    assert _modes(editor_client, emitter_id)["Mode 1"]["line"]["rf_max_mhz"] == 3100

    apply = f"/ai/chats/{chat['id']}/edit-proposals/apply"
    # One that can't be applied refuses the lot.
    assert editor_client.post(apply, json={"message_index": 1, "edit_ids": [ok["id"], bad["id"]]}).status_code == 409
    editor_client.post(f"/emitters/{emitter_id}/checkout")
    resp = editor_client.post(apply, json={"message_index": 1, "edit_ids": [ok["id"]]})
    assert resp.status_code == 200, resp.text
    [edited] = resp.json()["edited"]
    assert (edited["name"], edited["line"]["rf_max_mhz"], edited["line"]["rf_delta"]) == ("Search 1", 3120, 2)
    modes = _modes(editor_client, emitter_id)
    assert set(modes) == {"Search 1", "Mode 2"} and modes["Mode 2"]["line"]["pw_max_us"] == 1.2
    # Audited as an edit of the Mode, saying where it came from.
    log = editor_client.get("/audit-log", params={"emitter_id": emitter_id, "entity_type": "mode"}).json()["items"]
    assert log[0]["summary"] == "Renamed Mode 'Mode 1' to 'Search 1' — proposed by the AI chat"
    assert log[0]["changes"]["rf_max_mhz"] == {"old": 3100, "new": 3120}
    assert resp.json()["chat"]["messages"][1]["reply"]["edit_proposals"][0]["status"] == "applied"
    # Once only.
    assert editor_client.post(apply, json={"message_index": 1, "edit_ids": [ok["id"]]}).status_code == 409


def test_an_edit_is_refused_when_the_mode_changed_since(
    editor_client, viewer_client, fake_llm, emitter_with_two_overlapping_modes  # noqa: F811
):
    emitter_id = emitter_with_two_overlapping_modes["emitter"]["id"]
    fake_llm.replies = [EDITS, {"action": "answer", "answer": "Proposed."}]
    chat = editor_client.post("/ai/chats", json={"content": "Widen Mode 1"}).json()
    ok = chat["messages"][1]["reply"]["edit_proposals"][0]
    body = {"message_index": 1, "edit_ids": [ok["id"]]}
    # A viewer can't apply, nor anyone but the chat's owner.
    assert viewer_client.post(f"/ai/chats/{chat['id']}/edit-proposals/apply", json=body).status_code == 403

    editor_client.post(f"/emitters/{emitter_id}/checkout")
    mode = _modes(editor_client, emitter_id)["Mode 1"]
    group_id = mode["ew_group_id"]
    editor_client.patch(f"/ew-groups/{group_id}/modes/{mode['id']}", json={"pri_type": "fixed", "line": {**FIXED_LINE, "rf_max_mhz": 3105}})
    resp = editor_client.post(f"/ai/chats/{chat['id']}/edit-proposals/apply", json=body)
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Mode 1 was changed since this was proposed (RF max) — ask again"
    assert _modes(editor_client, emitter_id)["Mode 1"]["line"]["rf_max_mhz"] == 3105


def test_applying_needs_the_emitter_checked_out_by_the_user(
    editor_client, fake_llm, emitter_with_two_overlapping_modes  # noqa: F811
):
    emitter_id = emitter_with_two_overlapping_modes["emitter"]["id"]
    assert editor_client.delete(f"/emitters/{emitter_id}/checkout").status_code == 200
    fake_llm.replies = [EDITS, {"action": "answer", "answer": "Proposed."}]
    chat = editor_client.post("/ai/chats", json={"content": "Widen Mode 1"}).json()
    ok = chat["messages"][1]["reply"]["edit_proposals"][0]
    resp = editor_client.post(f"/ai/chats/{chat['id']}/edit-proposals/apply", json={"message_index": 1, "edit_ids": [ok["id"]]})
    assert resp.status_code == 409 and "Start editing" in resp.json()["detail"]
