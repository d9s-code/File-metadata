"""The AI chat writing Modes — only ever by the user adding what it proposed —
images with a question, compacting a long chat, and how much of the context
it uses."""

import base64

from tests.integration.test_ai_review_api import fake_llm  # noqa: F401  (fixture)
from tests.integration.test_ambiguity_api import FIXED_LINE, emitter_with_two_overlapping_modes  # noqa: F401

# A 1×1 PNG.
PNG = "data:image/png;base64," + base64.b64encode(
    bytes.fromhex(
        "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
        "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082"
    )
).decode()

PROPOSAL = {
    "action": "propose_modes",
    "modes": [
        {
            "emitter": "Ambiguity Emitter",
            "ew_group": "Group A",
            "name": "Search 9",
            "pri_type": "fixed",
            "rf_min_mhz": 9400,
            "rf_max_mhz": 9500,
            "rf_delta": 2,
            "pw_min_us": 1,
            "pri_min_us": 1000,
            "pri_max_us": 1010,
            "jitter_min_us": 0,
            "jitter_max_us": 1,
        },
        {"emitter": "Ambiguity Emitter", "ew_group": "No such group", "name": "X", "pri_type": "cw", "rf_min_mhz": 5000},
    ],
}


def _modes(client, emitter_id):
    return {m["name"] for m in client.get(f"/emitters/{emitter_id}/modes").json()}


def test_proposed_modes_are_only_added_when_the_user_adds_them(
    editor_client, viewer_client, fake_llm, emitter_with_two_overlapping_modes  # noqa: F811
):
    emitter_id = emitter_with_two_overlapping_modes["emitter"]["id"]
    fake_llm.replies = [PROPOSAL, {"action": "answer", "answer": "I've proposed Search 9 — add it if it looks right."}]
    resp = editor_client.post("/ai/chats", json={"content": "Write a Search Mode at 9.4–9.5 GHz on Group A"})
    assert resp.status_code == 201, resp.text
    chat = resp.json()
    answer = chat["messages"][-1]
    ok, bad = answer["reply"]["proposals"]
    assert (ok["name"], ok["problem"], ok["status"], ok["source_name"]) == ("Search 9", None, "proposed", "Source A")
    assert ok["line"]["rf_max_mhz"] == 9500 and ok["line"]["pw_max_us"] == 1 and ok["dsl"]
    assert "no EW Group" in bad["problem"]
    # The model was told only the user can add them, and nothing was written.
    assert "only the user can add them" in fake_llm.requests[1]["messages"][-1]["content"]
    assert answer["reply"]["steps"][0]["args"] is None
    assert _modes(editor_client, emitter_id) == {"Mode 1", "Mode 2"}

    apply = f"/ai/chats/{chat['id']}/proposals/apply"
    # One that can't be added refuses the lot.
    assert editor_client.post(apply, json={"message_index": 1, "proposal_ids": [ok["id"], bad["id"]]}).status_code == 409
    editor_client.post(f"/emitters/{emitter_id}/checkout")
    resp = editor_client.post(apply, json={"message_index": 1, "proposal_ids": [ok["id"]]})
    assert resp.status_code == 200, resp.text
    [created] = resp.json()["created"]
    assert created["name"] == "Search 9" and created["line"]["rf_delta"] == 2
    assert _modes(editor_client, emitter_id) == {"Mode 1", "Mode 2", "Search 9"}
    # Logged as coming from the chat, beside the Mode's own "Created Mode" entry.
    log = editor_client.get("/audit-log", params={"emitter_id": emitter_id}).json()
    summaries = [e["summary"] for e in (log["items"] if isinstance(log, dict) else log)]
    assert "Added 1 Mode the AI chat proposed: Search 9" in summaries and "Created Mode 'Search 9'" in summaries
    kept = resp.json()["chat"]["messages"][1]["reply"]["proposals"][0]
    assert kept["status"] == "added" and kept["mode_id"] == created["id"]
    # Once only.
    assert editor_client.post(apply, json={"message_index": 1, "proposal_ids": [ok["id"]]}).status_code == 409


def test_a_viewer_gets_no_proposals_and_cant_add(
    editor_client, viewer_client, fake_llm, emitter_with_two_overlapping_modes  # noqa: F811
):
    # A viewer's chat isn't offered proposing, and is refused if the model proposes anyway.
    fake_llm.replies = [PROPOSAL, {"action": "answer", "answer": "An editor or admin can add that Mode."}]
    chat = viewer_client.post("/ai/chats", json={"content": "Write one"}).json()
    reply = chat["messages"][1]["reply"]
    assert reply["proposals"] == [] and reply["edit_proposals"] == []
    system = fake_llm.requests[0]["messages"][0]["content"]
    assert "propose_modes (" not in system and "only editors and admins" not in system and "is for editors and" in system
    assert "Not done: this user can only view the library" in fake_llm.requests[1]["messages"][-1]["content"]
    # Nor can a viewer add from anyone's proposal; a chat is only its owner's.
    fake_llm.replies = [PROPOSAL, {"action": "answer", "answer": "Proposed."}]
    editors = editor_client.post("/ai/chats", json={"content": "Write one"}).json()
    ok = editors["messages"][1]["reply"]["proposals"][0]
    assert "propose_modes (" in fake_llm.requests[-2]["messages"][0]["content"]
    body = {"message_index": 1, "proposal_ids": [ok["id"]]}
    assert viewer_client.post(f"/ai/chats/{editors['id']}/proposals/apply", json=body).status_code == 403
    assert viewer_client.post(f"/ai/chats/{editors['id']}/edit-proposals/apply", json={"message_index": 1, "edit_ids": ["x"]}).status_code == 403


def test_adding_needs_the_emitter_checked_out_by_the_user(
    editor_client, fake_llm, emitter_with_two_overlapping_modes  # noqa: F811
):
    emitter_id = emitter_with_two_overlapping_modes["emitter"]["id"]
    # Its creator stops editing it.
    assert editor_client.delete(f"/emitters/{emitter_id}/checkout").status_code == 200
    fake_llm.replies = [PROPOSAL, {"action": "answer", "answer": "Proposed."}]
    chat = editor_client.post("/ai/chats", json={"content": "Write one"}).json()
    ok = chat["messages"][1]["reply"]["proposals"][0]
    resp = editor_client.post(f"/ai/chats/{chat['id']}/proposals/apply", json={"message_index": 1, "proposal_ids": [ok["id"]]})
    assert resp.status_code == 409
    assert "Start editing" in resp.json()["detail"]


def test_images_go_with_the_question(viewer_client, fake_llm):  # noqa: F811
    fake_llm.replies = [{"action": "answer", "answer": "A PPI display."}]
    resp = viewer_client.post("/ai/chats", json={"content": "What is this?", "images": [PNG]})
    assert resp.status_code == 201, resp.text
    question = resp.json()["messages"][0]
    assert question["images"] == [PNG]
    sent = fake_llm.requests[-1]["messages"][-1]["content"]
    assert sent[0]["type"] == "text" and sent[1] == {"type": "image_url", "image_url": {"url": PNG}}

    # Later questions mention them rather than sending them again.
    fake_llm.replies = [{"action": "answer", "answer": "Yes."}]
    viewer_client.post(f"/ai/chats/{resp.json()['id']}/messages", json={"content": "Sure?"})
    earlier = [m for m in fake_llm.requests[-1]["messages"] if m["role"] == "user"][0]["content"]
    assert "1 image(s) were attached here" in earlier

    bad = viewer_client.post("/ai/chats", json={"content": "x", "images": ["data:text/plain;base64,aGk="]})
    assert bad.status_code == 422


def test_compacting_and_the_context(viewer_client, admin_client, fake_llm):  # noqa: F811
    fake_llm.replies = [{"action": "answer", "answer": "First answer."}]
    chat = viewer_client.post("/ai/chats", json={"content": "First question"}).json()
    assert chat["context"]["max"] == 32_768
    # After an answer: the model's own count (500 + 120 in the fake).
    assert chat["context"]["used"] >= 620

    fake_llm.replies = [{"summary": "They asked a first question and got a first answer."}]
    resp = viewer_client.post(f"/ai/chats/{chat['id']}/compact")
    assert resp.status_code == 200, resp.text
    compacted = resp.json()
    assert compacted["messages"][-1]["role"] == "summary" and compacted["messages"][-1]["covers"] == 2
    assert compacted["message_count"] == 2
    # Nothing new to compact.
    assert viewer_client.post(f"/ai/chats/{chat['id']}/compact").status_code == 422

    # The summary stands in for the turns before it.
    fake_llm.replies = [{"action": "answer", "answer": "Second answer."}]
    viewer_client.post(f"/ai/chats/{chat['id']}/messages", json={"content": "Second question"})
    sent = fake_llm.requests[-1]["messages"]
    assert "got a first answer" in sent[0]["content"]
    assert not any(m["content"] == "First answer." for m in sent)

    # The max is an admin's setting.
    assert viewer_client.patch("/settings", json={"ai_chat_max_context_tokens": 8192}).status_code == 403
    assert admin_client.patch("/settings", json={"ai_chat_max_context_tokens": 8192}).json()["ai_chat_max_context_tokens"] == 8192
    assert viewer_client.get(f"/ai/chats/{chat['id']}").json()["context"]["max"] == 8192
