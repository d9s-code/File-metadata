"""The MDF change log as it reads: full, names only, counts only or plain
sentences, grouped by change or by Platform — the same on the page and in
the release-notes document, whose parts can be left out and whose release
notes can be swapped for a plain-language draft (edited)."""

import io
import zipfile

from app.services import llm_client
from app.services.release_notes_ai import PlainDraft
from tests.integration.test_emitter_report_api import FIXED, _emitter, _platform
from tests.integration.test_mdf_plan_api import _save


def _build(client):
    """v1: Alpha Ship carrying Radar One (Search). v2: Radar One gains Track; Bravo Ship added, carrying Radar Two."""
    one = _emitter(client, "Radar One", None, [("Search", "fixed", FIXED)])
    alpha = _platform(client, "Alpha Ship", one)
    pa = _save(client, "platforms", alpha["id"])
    mdf = client.post("/mdfs", json={"name": "Log MDF"}).json()
    client.post(f"/mdfs/{mdf['id']}/links", json={"platform_id": alpha["id"], "platform_version_id": pa["id"]})
    _save(client, "mdfs", mdf["id"])
    client.put(f"/mdfs/{mdf['id']}/versions/1/release-notes", json={"text": "First cut."})
    group = client.get(f"/emitters/{one[0]['id']}/ew-groups").json()[0]
    source = client.get(f"/emitters/{one[0]['id']}/sources").json()[0]
    client.post(f"/ew-groups/{group['id']}/modes", json={"source_id": source["id"], "name": "Track", "pri_type": "fixed", "line": FIXED})
    ev2 = _save(client, "emitters", one[0]["id"])
    client.post(f"/platforms/{alpha['id']}/links", json={"emitter_id": one[0]["id"], "emitter_version_id": ev2["id"]})
    pa2 = _save(client, "platforms", alpha["id"])
    two = _emitter(client, "Radar Two", None, [("Nav", "fixed", FIXED)])
    bravo = _platform(client, "Bravo Ship", two)
    pb = _save(client, "platforms", bravo["id"])
    client.post(f"/mdfs/{mdf['id']}/links", json={"platform_id": alpha["id"], "platform_version_id": pa2["id"]})
    client.post(f"/mdfs/{mdf['id']}/links", json={"platform_id": bravo["id"], "platform_version_id": pb["id"]})
    _save(client, "mdfs", mdf["id"])
    client.put(f"/mdfs/{mdf['id']}/versions/2/release-notes", json={"text": "Adds Bravo Ship and the Track mode."})
    return mdf["id"]


def _log(client, mdf_id, detail, group="change"):
    r = client.get(f"/mdfs/{mdf_id}/summary", params={"from_version": 1, "detail": detail, "group": group})
    assert r.status_code == 200, r.text
    return [(b["type"], b["text"], b["mark"], b["items"]) for b in r.json()["change_log"]["blocks"]]


def test_each_level_of_detail_grouped_by_change(editor_client):
    mid = _build(editor_client)
    assert _log(editor_client, mid, "full") == [
        ("heading", "Added", None, []),
        ("line", "Platform Bravo Ship — 1 Emitter", "added", []),
        ("line", "Emitter Radar Two — on Bravo Ship · 1 Mode", "added", []),
        ("heading", "Updated", None, []),
        ("line", "Emitter Radar One", "updated", ["1 Mode added: Track"]),
    ]
    assert [t for _, t, _, _ in _log(editor_client, mid, "names")] == ["Added", "Platform Bravo Ship", "Emitter Radar Two", "Updated", "Emitter Radar One"]
    assert _log(editor_client, mid, "counts") == [("line", "Added: 1 Platform, 1 Emitter", "added", []), ("line", "Updated: 1 Emitter", "updated", [])]
    assert _log(editor_client, mid, "sentences") == [
        ("paragraph", "This release adds the Platform Bravo Ship and the Emitter Radar Two and updates the Emitter Radar One.", None, [])
    ]
    assert editor_client.get(f"/mdfs/{mid}/summary", params={"detail": "chatty"}).status_code == 422
    assert editor_client.get(f"/mdfs/{mid}/summary", params={"group": "colour"}).status_code == 422


def test_grouped_by_platform(editor_client):
    mid = _build(editor_client)
    assert _log(editor_client, mid, "full", "platform") == [
        ("heading", "Platform Alpha Ship", None, []),
        ("line", "Radar One", "updated", ["1 Mode added: Track"]),
        ("heading", "Platform Bravo Ship (added)", None, []),
        ("line", "Radar Two — 1 Mode", "added", []),
    ]
    assert [t for _, t, _, _ in _log(editor_client, mid, "counts", "platform")] == ["Alpha Ship: 1 Emitter updated", "Bravo Ship (added): carries 1 Emitter"]
    assert [t for _, t, _, _ in _log(editor_client, mid, "sentences", "platform")] == [
        "On Alpha Ship: 1 Emitter updated (Radar One).",
        "Bravo Ship is new, carrying 1 Emitter (Radar Two).",
    ]


def _doc(content: bytes) -> str:
    return zipfile.ZipFile(io.BytesIO(content)).read("word/document.xml").decode()


def test_the_document_as_asked(editor_client):
    mid = _build(editor_client)
    # As before, by default: everything, in full.
    full = _doc(editor_client.get(f"/mdfs/{mid}/summary.docx", params={"from_version": 1}).content)
    for expected in ("Release notes", "Adds Bravo Ship and the Track mode.", "Emitter Radar One: 1 Mode added: Track", "Contents of v2", "Changes from v1"):
        assert expected in full, expected
    # Counts only, no contents table, no span or details.
    lean = _doc(editor_client.get(f"/mdfs/{mid}/summary.docx", params={"from_version": 1, "detail": "counts", "parts": "release_notes"}).content)
    assert "Added: 1 Platform, 1 Emitter" in lean and "Contents of v2" not in lean and "Changes from v1" not in lean
    assert "Radar One" not in lean
    # The release notes swapped for a plain-language text (edited), in paragraphs.
    r = editor_client.post(
        f"/mdfs/{mid}/summary.docx",
        json={"from_version": 1, "detail": "sentences", "parts": ["release_notes"], "release_notes_text": "Bravo Ship is new.\n\nRadar One was updated."},
    )
    assert r.status_code == 200, r.text
    plain = _doc(r.content)
    assert "Bravo Ship is new." in plain and "Radar One was updated." in plain and "Adds Bravo Ship and the Track mode." not in plain
    assert "This release adds the Platform Bravo Ship" in plain
    assert editor_client.post(f"/mdfs/{mid}/summary.docx", json={"parts": ["cover"]}).status_code == 422


def test_a_plain_language_draft(editor_client, monkeypatch):
    mid = _build(editor_client)
    seen = {}

    def fake(system, user, schema, **_):
        seen["context"] = user
        return PlainDraft(text="Bravo Ship is new, with Radar Two. Radar One was updated. It now has 12 modes."), llm_client.LlmReply(
            model="test", seconds=0.1, prompt_tokens=1, completion_tokens=1
        )

    monkeypatch.setattr(llm_client, "chat_json", fake)
    r = editor_client.post(f"/mdfs/{mid}/summary/plain-draft", json={"from_version": 1})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["text"].startswith("Bravo Ship is new") and body["model"] == "test"
    # A number it wasn't given is pointed out.
    assert body["unverified_numbers"] == ["12"]
    # It's given the summary only: the notes written and the change notes.
    assert "Adds Bravo Ship and the Track mode." in seen["context"] and "1 Mode added: Track" in seen["context"]

    def down(*_a, **_k):
        raise llm_client.LlmNotConfigured("No language model is set up")

    monkeypatch.setattr(llm_client, "chat_json", down)
    assert editor_client.post(f"/mdfs/{mid}/summary/plain-draft", json={"from_version": 1}).status_code == 503
