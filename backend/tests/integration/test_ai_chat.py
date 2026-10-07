"""The AI chat: the model looks things up (read-only) before answering, and
each person's settings for the AI features."""

from tests.integration.test_ai_review_api import fake_llm  # noqa: F401  (fixture)
from tests.integration.test_ambiguity_api import emitter_with_two_overlapping_modes  # noqa: F401  (fixture)


def _ask(client, text, page=None, history=()):
    return client.post("/ai/chat", json={"messages": [*history, {"role": "user", "content": text}], "page": page})


def test_the_chat_looks_an_emitter_up_before_answering(
    viewer_client, fake_llm, emitter_with_two_overlapping_modes  # noqa: F811
):
    fake_llm.replies = [
        {"action": "get_emitter", "target": "ambiguity emitter"},
        {"action": "answer", "answer": "It has 2 Modes, both at RF 2900–3100 MHz; one is at 4400 MHz."},
    ]
    resp = _ask(viewer_client, "What Modes does Ambiguity Emitter have?")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["reply"].startswith("It has 2 Modes")
    assert body["steps"] == [{"action": "get_emitter", "label": "Emitter ambiguity emitter"}]
    assert body["unverified_numbers"] == ["4400"]  # in no lookup's result
    assert body["model"] == "fake-gemma"

    lookup = fake_llm.requests[1]["messages"][-1]["content"]
    assert lookup.startswith("Result of get_emitter:")
    assert "Emitter Ambiguity Emitter" in lookup and "EW group Group A:" in lookup
    assert "Mode 1 (fixed) · RF 2900–3100 ±1 MHz" in lookup


def test_find_modes_and_search(editor_client, fake_llm, emitter_with_two_overlapping_modes):  # noqa: F811
    fake_llm.replies = [
        {"action": "find_modes", "rf_mhz": 3100.5, "pw_us": 1.0},
        {"action": "find_modes", "rf_mhz": 5000},
        {"action": "search", "query": "mode"},
        {"action": "answer", "answer": "Both."},
    ]
    assert _ask(editor_client, "Which Modes match RF 3100.5 MHz, PW 1 µs?").status_code == 200
    results = [r["messages"][-1]["content"] for r in fake_llm.requests[1:]]
    assert "2 Modes cover RF 3100.5 MHz, PW 1 µs" in results[0]  # inside the ±1 MHz margin
    assert "No Mode covers RF 5000 MHz" in results[1]
    assert "Modes:" in results[2] and "Mode 1 — Emitter Ambiguity Emitter" in results[2]


def test_the_lookups_are_capped_then_it_must_answer(editor_client, fake_llm):  # noqa: F811
    fake_llm.replies = [{"action": "overview"}] * 5 + [{"action": "answer", "answer": "Done."}]
    body = _ask(editor_client, "Count everything").json()
    assert len(body["steps"]) == 5 and body["reply"] == "Done."
    last = fake_llm.requests[-1]
    assert last["response_format"]["json_schema"]["name"] == "FinalStep"
    assert "answer now" in last["messages"][-1]["content"]


def test_it_knows_the_page_unless_switched_off(
    editor_client, fake_llm, emitter_with_two_overlapping_modes  # noqa: F811
):
    emitter = emitter_with_two_overlapping_modes["emitter"]
    fake_llm.reply = {"action": "answer", "answer": "Yes."}
    body = _ask(editor_client, "Is this one validated?", page=f"/emitters/{emitter['id']}").json()
    assert body["page"] is True
    assert f'Emitter "Ambiguity Emitter" [{emitter["id"]}]' in fake_llm.requests[-1]["messages"][0]["content"]

    editor_client.patch("/auth/me/preferences", json={"ai_chat_page": False})
    body = _ask(editor_client, "Is this one validated?", page=f"/emitters/{emitter['id']}").json()
    assert body["page"] is False
    assert "looking at" not in fake_llm.requests[-1]["messages"][0]["content"]


def test_earlier_turns_go_with_the_question(editor_client, fake_llm):  # noqa: F811
    fake_llm.reply = {"action": "answer", "answer": "As I said."}
    history = [{"role": "user", "content": "Hello"}, {"role": "assistant", "content": "Hi — ask me anything."}]
    assert _ask(editor_client, "And again?", history=history).status_code == 200
    sent = fake_llm.requests[-1]["messages"]
    assert [m["role"] for m in sent] == ["system", "user", "assistant", "user"]
    assert sent[2]["content"] == "Hi — ask me anything."
    # The last message must be the person's.
    resp = editor_client.post("/ai/chat", json={"messages": history})
    assert resp.status_code == 422


def test_without_a_model_the_chat_says_so(editor_client):
    resp = _ask(editor_client, "Hello")
    assert resp.status_code == 503


def test_everyone_has_their_own_settings(editor_client, viewer_client):
    assert editor_client.get("/auth/me").json()["preferences"] == {"ai_chat": True, "ai_chat_page": True, "ai_drafts": True}
    resp = editor_client.patch("/auth/me/preferences", json={"ai_chat": False})
    assert resp.status_code == 200
    assert resp.json()["preferences"]["ai_chat"] is False
    assert editor_client.get("/auth/me").json()["preferences"] == {"ai_chat": False, "ai_chat_page": True, "ai_drafts": True}
    assert viewer_client.get("/auth/me").json()["preferences"]["ai_chat"] is True  # someone else's
    assert editor_client.patch("/auth/me/preferences", json={"dark_magic": True}).status_code == 422
