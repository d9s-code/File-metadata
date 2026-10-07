"""The documentation the language model is given as background: copied from
(a fake) Outline, the relevant sections picked per question, cited."""

from datetime import datetime, timedelta, timezone

import pytest

from app.config import settings
from app.models.knowledge import KnowledgeSection, KnowledgeSync
from app.services import knowledge_service

from tests.integration.test_ai_review_api import EXPLANATION, SUMMARY, _finding, fake_llm  # noqa: F401  (fixture)
from tests.integration.test_ambiguity_api import emitter_with_two_overlapping_modes  # noqa: F401  (fixture)
from tests.unit.test_outline_client import outline  # noqa: F401  (fixture)


@pytest.fixture()
def docs(outline, monkeypatch, db_session):  # noqa: F811
    fake = outline(pages=3)
    monkeypatch.setattr(settings, "outline_collection", "PRS")
    monkeypatch.setattr(settings, "outline_root", None)
    return fake


def test_the_documentation_is_copied_by_heading_with_links(docs, db_session):
    state = knowledge_service.sync()
    assert state["label"] == 'collection "PRS"'
    assert state["pages"] == 4 and state["error"] is None
    rows = db_session.query(KnowledgeSection).order_by(KnowledgeSection.position).all()
    by_path = {r.path: r for r in rows}
    frame = by_path["Stagger logic › Frame detection"]
    assert frame.url.endswith("/doc/page-0#h-frame-detection")
    assert "sums consecutive intervals" in frame.text
    assert by_path["Stagger logic"].url.endswith("/doc/page-0")  # the text above the first heading
    assert state["sections"] == len(rows)

    # Synced again: rebuilt, not doubled.
    knowledge_service.sync()
    assert db_session.query(KnowledgeSection).count() == len(rows)


def test_a_failed_sync_keeps_the_last_copy_and_says_why(docs, db_session, monkeypatch):
    knowledge_service.sync()
    count = db_session.query(KnowledgeSection).count()
    monkeypatch.setattr(settings, "outline_api_token", "revoked")
    with pytest.raises(Exception, match="401"):
        knowledge_service.sync()
    db_session.expire_all()
    state = knowledge_service.status(db_session)
    assert "401" in state["error"] and state["synced_at"] is not None
    assert db_session.query(KnowledgeSection).count() == count

    # A question doesn't retry straight after a failure, nor sync a fresh copy.
    calls = len(docs.calls)
    knowledge_service.ensure_fresh(db_session)
    assert len(docs.calls) == calls


def test_a_stale_copy_is_refreshed_on_the_next_question(docs, db_session):
    knowledge_service.sync()
    calls = len(docs.calls)
    knowledge_service.ensure_fresh(db_session)
    assert len(docs.calls) == calls  # fresh: Outline isn't asked
    row = db_session.get(KnowledgeSync, 1)
    row.synced_at = datetime.now(timezone.utc) - timedelta(minutes=settings.outline_sync_minutes + 1)
    db_session.commit()
    knowledge_service.ensure_fresh(db_session)
    assert len(docs.calls) > calls


def _section(db, position: int, path: str, text: str, tokens: int = 500):
    db.add(
        KnowledgeSection(
            outline_doc_id="d", path=path, url=f"https://outline.app/doc/x#{position}", text=text,
            tokens=tokens, position=position,
        )
    )


def test_only_the_matching_sections_go_when_not_all_fit(db_session):
    _section(db_session, 0, "Manual › Introduction", "Who the team is and how to log in.")
    _section(db_session, 1, "Manual › Stagger", "A staggered PRI repeats a sequence of intervals; the frame time is their sum.")
    _section(db_session, 2, "Manual › Jitter", "Jittered PRI varies randomly around its mean.")
    _section(db_session, 3, "Manual › Priorities", "Priority of tasks in the lab.")  # "pri" must not find this
    _section(db_session, 4, "Manual › Range matching", "With range matching the sensor matches a stagger on its frame time.")
    db_session.commit()

    picked = knowledge_service.select_sections(db_session, ["stagger", "range matching"], ["PRI"], budget=1000)
    assert [s.path for s in picked] == ["Manual › Stagger", "Manual › Range matching"]  # reading order
    assert [s.ref for s in picked] == ["S1", "S2"]

    # Everything fits: everything goes, in order.
    everything = knowledge_service.select_sections(db_session, ["stagger"], [], budget=10_000)
    assert len(everything) == 5 and everything[0].path == "Manual › Introduction"

    assert knowledge_service.select_sections(db_session, ["radome"], [], budget=1000) == []


def test_explanations_cite_the_documentation(
    docs, fake_llm, editor_client, emitter_with_two_overlapping_modes  # noqa: F811
):
    fake_llm.reply = {**EXPLANATION, "explanation": EXPLANATION["explanation"] + " Matching is per [S2]; see [S9]."}
    _, finding = _finding(editor_client, emitter_with_two_overlapping_modes["emitter"]["id"])
    resp = editor_client.post(f"/ambiguity/findings/{finding['id']}/explain")
    assert resp.status_code == 200, resp.text
    draft = resp.json()["ai_explanation"]

    sent = fake_llm.requests[0]["messages"]
    assert "[S2]" in sent[0]["content"]  # the system prompt asks for citations
    assert "Background — sections of the team's documentation" in sent[1]["content"]
    assert "[S1] Page 1" in sent[1]["content"] or "[S1] Lazy page" in sent[1]["content"]
    assert "sums consecutive intervals" in sent[1]["content"]

    by_ref = {s["ref"]: s for s in draft["sources"]}
    assert by_ref["S2"]["cited"] is True and by_ref["S1"]["cited"] is False
    assert by_ref["S2"]["url"].startswith("http")
    assert draft["unknown_citations"] == ["S9"]
    assert draft["documentation"]["label"] == 'collection "PRS"'


def test_the_summary_goes_ahead_without_documentation_when_outline_is_down(
    docs, fake_llm, editor_client, monkeypatch, emitter_with_two_overlapping_modes  # noqa: F811
):
    monkeypatch.setattr(settings, "outline_api_token", "revoked")
    fake_llm.reply = SUMMARY
    run, _ = _finding(editor_client, emitter_with_two_overlapping_modes["emitter"]["id"])
    resp = editor_client.post(f"/ambiguity/runs/{run['id']}/summary")
    assert resp.status_code == 200, resp.text
    summary = resp.json()["ai_summary"]
    assert summary["sources"] == [] and summary["overview"] == SUMMARY["overview"]
    assert "Background" not in fake_llm.requests[0]["messages"][1]["content"]
    status = editor_client.get("/ai/status").json()["documentation"]
    assert "401" in status["error"]


def test_only_an_admin_syncs_on_demand(docs, admin_client, editor_client, monkeypatch):
    assert editor_client.post("/ai/documentation/sync").status_code == 403
    resp = admin_client.post("/ai/documentation/sync")
    assert resp.status_code == 200, resp.text
    assert resp.json()["sections"] > 0
    assert editor_client.get("/ai/status").json()["documentation"]["sections"] == resp.json()["sections"]

    monkeypatch.setattr(settings, "outline_collection", None)
    assert admin_client.post("/ai/documentation/sync").status_code == 409
    assert editor_client.get("/ai/status").json()["documentation"] is None
