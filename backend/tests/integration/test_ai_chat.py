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
    assert body["steps"] == [
        {"action": "get_emitter", "label": "Emitter ambiguity emitter", "args": {"action": "get_emitter", "target": "ambiguity emitter"}}
    ]
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
    assert "Modes:" in results[2] and "Mode 1 (Ambiguity Emitter · Group A)" in results[2]


def test_the_lookups_are_capped_then_it_must_answer(editor_client, fake_llm):  # noqa: F811
    fake_llm.replies = [{"action": "overview"}] * 6 + [{"action": "answer", "answer": "Done."}]
    body = _ask(editor_client, "Count everything").json()
    assert len(body["steps"]) == 6 and body["reply"] == "Done."
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


def test_the_chat_remembers_what_it_looked_up(
    editor_client, fake_llm, emitter_with_two_overlapping_modes  # noqa: F811
):
    """A follow-up brings the earlier answer's lookups; they're run again and
    given to the model, so "its" and "the other one" have something to go on."""
    fake_llm.replies = [
        {"action": "get_emitter", "target": "Ambiguity Emitter"},
        {"action": "answer", "answer": "It has 2 Modes."},
    ]
    first = _ask(editor_client, "What Modes does Ambiguity Emitter have?").json()
    assert first["remembered"] == 0
    lookups = [s["args"] for s in first["steps"]]

    fake_llm.replies = [{"action": "answer", "answer": "Both are fixed PRI."}]
    history = [
        {"role": "user", "content": "What Modes does Ambiguity Emitter have?"},
        {"role": "assistant", "content": first["reply"], "lookups": lookups},
    ]
    second = _ask(editor_client, "And their PRI type?", history=history).json()
    assert second["remembered"] == 1 and second["steps"] == []
    question = fake_llm.requests[-1]["messages"][-1]["content"]
    assert question.startswith("And their PRI type?")
    assert "What you looked up for your earlier answers" in question
    assert "[Emitter Ambiguity Emitter]" in question and "Mode 1 (fixed)" in question

    # Only lookups the model could ask for are run; anything else is dropped.
    history[1]["lookups"] = [{"action": "drop_tables"}, {"action": "answer", "answer": "x"}, {"nonsense": 1}]
    fake_llm.replies = [{"action": "answer", "answer": "Hm."}]
    assert _ask(editor_client, "And?", history=history).json()["remembered"] == 0


def test_search_matches_words_designations_and_notes(editor_client, fake_llm):  # noqa: F811
    emitter = editor_client.post(
        "/emitters", json={"name": "Fire Control Radar", "designation": "FCR-7", "description": "Seen near the coast"}
    ).json()
    fake_llm.replies = [
        {"action": "search", "query": "radar fire"},  # every word, any order
        {"action": "search", "query": "coast"},  # only in the description
        {"action": "search", "query": "fire banana"},  # some of the words
        {"action": "get_emitter", "target": "FCR-7"},  # by designation
        {"action": "answer", "answer": "Found it."},
    ]
    assert _ask(editor_client, "Find the fire control radar").status_code == 200
    results = [r["messages"][-1]["content"] for r in fake_llm.requests[1:]]
    assert "Emitters:" in results[0] and "FCR-7 — Fire Control Radar" in results[0]
    assert "these mention it" in results[1] and emitter["id"] in results[1]
    assert "Matches for some of the words" in results[2] and "Fire Control Radar" in results[2]
    assert results[3].startswith("Result of get_emitter:\nEmitter Fire Control Radar")
    assert "Status: In progress" in results[3]  # as the app calls it, not "draft"


def test_lists_tests_mdfs_and_bands(editor_client, fake_llm, emitter_with_two_overlapping_modes):  # noqa: F811
    emitter = emitter_with_two_overlapping_modes["emitter"]
    platform = editor_client.post("/platforms", json={"name": "Chat Platform"}).json()
    editor_client.post(
        f"/platforms/{platform['id']}/links",
        json={"emitter_id": emitter["id"], "emitter_version_id": emitter_with_two_overlapping_modes["version"]["id"]},
    )
    editor_client.post(f"/platforms/{platform['id']}/versions", json={"change_summary": "v1"})
    mdf = editor_client.post("/mdfs", json={"name": "Chat MDF"}).json()
    versions = editor_client.get(f"/platforms/{platform['id']}/versions").json()
    editor_client.post(
        f"/mdfs/{mdf['id']}/links", json={"platform_id": platform["id"], "platform_version_id": versions[-1]["id"]}
    )
    editor_client.post(
        f"/emitters/{emitter['id']}/test-records",
        json={"test_type": "intercept", "title": "Range day", "test_date": "2026-10-01", "result": "fail"},
    )
    fake_llm.replies = [
        {"action": "list_emitters", "status": "in progress", "target": "Chat Platform"},
        {"action": "list_emitters", "status": "flying"},
        {"action": "get_tests", "target": "Ambiguity Emitter"},
        {"action": "get_mdf", "target": "Chat MDF"},
        {"action": "find_modes", "rf_mhz": 3050, "rf_max_mhz": 3500},
        {"action": "answer", "answer": "Done."},
    ]
    body = _ask(editor_client, "Tell me about the Chat Platform").json()
    assert [s["label"] for s in body["steps"]] == [
        "Emitters status in progress on Chat Platform",
        "Emitters status flying",
        "Tests of Ambiguity Emitter",
        "MDF Chat MDF",
        "Modes matching RF 3050–3500",
    ]
    results = [r["messages"][-1]["content"] for r in fake_llm.requests[1:]]
    assert "1 Emitters (status In progress, on Platform Chat Platform)" in results[0]
    assert "Ambiguity Emitter" in results[0] and "2 Modes" in results[0]
    assert "is not a status" in results[1] and "Operational" in results[1]
    assert "Range day — 01.10.2026" in results[2] and "result fail" in results[2] and "version v1" in results[2]
    assert "MDF Chat MDF" in results[3] and "Chat Platform v" in results[3] and "Readiness:" in results[3]
    assert "2 Modes cover RF 3050–3500 MHz" in results[4]


def test_names_in_the_answer_link_to_their_pages(
    editor_client, fake_llm, emitter_with_two_overlapping_modes  # noqa: F811
):
    emitter = emitter_with_two_overlapping_modes["emitter"]
    fake_llm.replies = [
        {"action": "get_emitter", "target": "ambiguity emitter"},
        {"action": "answer", "answer": "Ambiguity Emitter has Mode 1 and Mode 2."},
    ]
    links = _ask(editor_client, "What Modes does it have?").json()["links"]
    assert {link["text"]: link["url"] for link in links} == {
        "Ambiguity Emitter": f"/emitters/{emitter['id']}",
        "Mode 1": f"/emitters/{emitter['id']}?tab=modes&mode=Mode%201",
        "Mode 2": f"/emitters/{emitter['id']}?tab=modes&mode=Mode%202",
    }
    assert links[0]["text"] == "Ambiguity Emitter"  # longest first

    # Nothing looked up: nothing to link, even when a name is mentioned.
    fake_llm.replies = [{"action": "answer", "answer": "Ambiguity Emitter, I think."}]
    assert _ask(editor_client, "Guess one").json()["links"] == []
