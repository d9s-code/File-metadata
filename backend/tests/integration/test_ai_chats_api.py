"""Saved AI chats: kept per person, carried on, renamed, deleted — and
nobody else's to see."""

from tests.integration.test_ai_review_api import fake_llm  # noqa: F401  (fixture)
from tests.integration.test_ambiguity_api import emitter_with_two_overlapping_modes  # noqa: F401  (fixture)


def test_a_chat_is_kept_and_carried_on(viewer_client, fake_llm, emitter_with_two_overlapping_modes):  # noqa: F811
    fake_llm.replies = [
        {"action": "get_emitter", "target": "ambiguity emitter"},
        {"action": "answer", "answer": "It has 2 Modes."},
    ]
    resp = viewer_client.post("/ai/chats", json={"content": "What Modes does   Ambiguity Emitter have?"})
    assert resp.status_code == 201, resp.text
    chat = resp.json()
    assert chat["title"] == "What Modes does Ambiguity Emitter have?"
    assert [(m["role"], m["content"]) for m in chat["messages"]] == [
        ("user", "What Modes does   Ambiguity Emitter have?"),
        ("assistant", "It has 2 Modes."),
    ]
    assert chat["messages"][1]["reply"]["steps"][0]["action"] == "get_emitter"

    # Carried on: the model is given the conversation, and what was looked up before.
    fake_llm.replies = [{"action": "answer", "answer": "Both are fixed."}]
    resp = viewer_client.post(f"/ai/chats/{chat['id']}/messages", json={"content": "And their PRI types?"})
    assert resp.status_code == 200, resp.text
    again = resp.json()
    assert [m["content"] for m in again["messages"]][-1] == "Both are fixed."
    assert again["messages"][-1]["reply"]["remembered"] == 1
    sent = fake_llm.requests[-1]["messages"]
    assert any(m["content"] == "It has 2 Modes." for m in sent)

    [listed] = viewer_client.get("/ai/chats").json()
    assert listed["id"] == chat["id"] and listed["message_count"] == 4
    assert viewer_client.get(f"/ai/chats/{chat['id']}").json()["messages"] == again["messages"]


def test_rename_delete_and_nobody_elses(viewer_client, editor_client, fake_llm):  # noqa: F811
    fake_llm.replies = [{"action": "answer", "answer": "Hello."}]
    chat = viewer_client.post("/ai/chats", json={"content": "Hi"}).json()
    fake_llm.replies = [{"action": "answer", "answer": "Second."}]
    second = viewer_client.post("/ai/chats", json={"content": "Another"}).json()
    # The latest first.
    assert [c["id"] for c in viewer_client.get("/ai/chats").json()] == [second["id"], chat["id"]]

    renamed = viewer_client.patch(f"/ai/chats/{chat['id']}", json={"title": "  Greeting  "})
    assert renamed.status_code == 200 and renamed.json()["title"] == "Greeting"
    # Renaming isn't new activity: it keeps its place.
    assert [c["id"] for c in viewer_client.get("/ai/chats").json()] == [second["id"], chat["id"]]

    # Someone else's chat isn't there for them.
    assert editor_client.get("/ai/chats").json() == []
    assert editor_client.get(f"/ai/chats/{chat['id']}").status_code == 404
    assert editor_client.post(f"/ai/chats/{chat['id']}/messages", json={"content": "x"}).status_code == 404
    assert editor_client.delete(f"/ai/chats/{chat['id']}").status_code == 404

    assert viewer_client.delete(f"/ai/chats/{chat['id']}").status_code == 204
    assert [c["id"] for c in viewer_client.get("/ai/chats").json()] == [second["id"]]
    assert viewer_client.get(f"/ai/chats/{chat['id']}").status_code == 404


def test_a_failed_answer_is_kept_and_can_be_asked_again(editor_client, fake_llm, monkeypatch):  # noqa: F811
    from app.services import llm_client

    # The model isn't set up: the question is kept, with why.
    url = llm_client.settings.llm_base_url
    monkeypatch.setattr(llm_client.settings, "llm_base_url", None)
    resp = editor_client.post("/ai/chats", json={"content": "Count the Emitters"})
    assert resp.status_code == 201, resp.text
    chat = resp.json()
    assert chat["messages"][-1]["error"] is True
    assert "LLM_BASE_URL" in chat["messages"][-1]["content"]

    # Asked again: the failed pair is replaced, not kept.
    monkeypatch.setattr(llm_client.settings, "llm_base_url", url)
    fake_llm.replies = [{"action": "answer", "answer": "There are none."}]
    resp = editor_client.post(f"/ai/chats/{chat['id']}/messages", json={"content": "Count the Emitters", "retry": True})
    assert resp.status_code == 200, resp.text
    assert [(m["role"], m["content"], m.get("error")) for m in resp.json()["messages"]] == [
        ("user", "Count the Emitters", None),
        ("assistant", "There are none.", None),
    ]
