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
    two = _emitter(client, "Radar Two", "RT-2", [("Nav", "fixed", FIXED)])
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
    return r.json()["change_log"]["blocks"]


def _table(blocks):
    """The one table: its columns, then (mark, cells) per row."""
    assert [b["type"] for b in blocks] == ["table"], blocks
    return blocks[0]["columns"], [(r["mark"], r["cells"]) for r in blocks[0]["rows"]]


def _text(blocks):
    return [b["text"] for b in blocks]


def test_each_level_of_detail_grouped_by_change(editor_client):
    mid = _build(editor_client)
    assert _table(_log(editor_client, mid, "full")) == (
        ["Change", "Type", "Name", "Details"],
        [
            ("added", ["Added", "Platform", "Bravo Ship", ["1 Emitter"]]),
            ("added", ["Added", "Emitter", "RT-2 — Radar Two", ["on Bravo Ship · 1 Mode"]]),
            ("updated", ["Updated", "Emitter", "Radar One", ["1 Mode added: Track"]]),
        ],
    )
    assert _log(editor_client, mid, "full")[0]["mark_column"] == 0
    assert _table(_log(editor_client, mid, "names")) == (
        ["Change", "Type", "Name"],
        [
            ("added", ["Added", "Platform", "Bravo Ship"]),
            ("added", ["Added", "Emitter", "RT-2 — Radar Two"]),
            ("updated", ["Updated", "Emitter", "Radar One"]),
        ],
    )
    assert _table(_log(editor_client, mid, "counts")) == (
        ["Change", "Platforms", "Emitters"],
        [("added", ["Added", "1", "1"]), ("updated", ["Updated", "—", "1"])],
    )
    assert _text(_log(editor_client, mid, "sentences")) == [
        "This release adds the Platform Bravo Ship and the Emitter RT-2 — Radar Two and updates the Emitter Radar One."
    ]
    contents = editor_client.get(f"/mdfs/{mid}/summary", params={"from_version": 1}).json()["contents"]
    assert [(e["designation"], e["name"]) for p in contents for e in p["emitters"]] == [(None, "Radar One"), ("RT-2", "Radar Two")]
    assert editor_client.get(f"/mdfs/{mid}/summary", params={"detail": "chatty"}).status_code == 422
    assert editor_client.get(f"/mdfs/{mid}/summary", params={"group": "colour"}).status_code == 422


def test_grouped_by_platform(editor_client):
    mid = _build(editor_client)
    # Added first, then updated, then removed.
    assert _table(_log(editor_client, mid, "full", "platform")) == (
        ["Platform", "Change", "Emitter", "Details"],
        [
            ("added", ["Bravo Ship (added)", "Added", "RT-2 — Radar Two", ["1 Mode"]]),
            ("updated", ["Alpha Ship", "Updated", "Radar One", ["1 Mode added: Track"]]),
        ],
    )
    assert _table(_log(editor_client, mid, "names", "platform"))[1] == [
        ("added", ["Bravo Ship (added)", "Added", "RT-2 — Radar Two"]),
        ("updated", ["Alpha Ship", "Updated", "Radar One"]),
    ]
    assert _table(_log(editor_client, mid, "counts", "platform")) == (
        ["Platform", "Change", "Emitters added", "Updated", "Removed"],
        [("added", ["Bravo Ship", "Added", "1", "—", "—"]), ("updated", ["Alpha Ship", "Updated", "—", "1", "—"])],
    )
    assert _text(_log(editor_client, mid, "sentences", "platform")) == [
        "Bravo Ship is new, carrying 1 Emitter (RT-2 — Radar Two).",
        "On Alpha Ship: 1 Emitter updated (Radar One).",
    ]


def test_added_then_updated_then_removed():
    from app.services.change_log import _by_change, _by_platform

    notes = {
        "added": [{"kind": "Emitter", "name": "New", "detail": None}],
        "removed": [{"kind": "Emitter", "name": "Gone", "detail": None}],
        "updated": [{"kind": "Emitter", "name": "Changed", "items": ["x"]}],
    }
    assert [r["cells"][0] for r in _by_change(notes, "names")[0]["rows"]] == ["Added", "Updated", "Removed"]
    assert _by_change(notes, "sentences")[0]["text"] == "This release adds the Emitter New, updates the Emitter Changed and removes the Emitter Gone."
    groups = [
        {"name": "Old ship", "mark": "removed", "entries": [{"mark": "removed", "name": "A", "detail": None, "items": []}]},
        {"name": "Same ship", "mark": "updated", "entries": [
            {"mark": "removed", "name": "B", "detail": None, "items": []},
            {"mark": "updated", "name": "C", "detail": None, "items": []},
            {"mark": "added", "name": "D", "detail": None, "items": []},
        ]},
        {"name": "New ship", "mark": "added", "entries": [{"mark": "added", "name": "E", "detail": None, "items": []}]},
    ]
    rows = _by_platform(groups, "names")[0]["rows"]
    assert [(r["cells"][0], r["cells"][2]) for r in rows] == [
        ("New ship (added)", "E"), ("Same ship", "D"), ("", "C"), ("", "B"), ("Old ship (removed)", "A")
    ]


def _doc(content: bytes) -> str:
    return zipfile.ZipFile(io.BytesIO(content)).read("word/document.xml").decode()


def test_the_document_as_asked(editor_client):
    mid = _build(editor_client)
    # As before, by default: everything, in full.
    full = _doc(editor_client.get(f"/mdfs/{mid}/summary.docx", params={"from_version": 1}).content)
    for expected in ("Release notes", "Adds Bravo Ship and the Track mode.", "1 Mode added: Track", "Contents of v2", "Changes from v1"):
        assert expected in full, expected
    # The contents name each Emitter with its designation; its version only in full detail.
    assert "RT-2 — Radar Two" in full and "Emitter version" in full
    names = _doc(editor_client.get(f"/mdfs/{mid}/summary.docx", params={"from_version": 1, "detail": "names"}).content)
    assert "RT-2 — Radar Two" in names and "Contents of v2" in names and "Emitter version" not in names
    # Counts only, no contents table, no span or details.
    lean = _doc(editor_client.get(f"/mdfs/{mid}/summary.docx", params={"from_version": 1, "detail": "counts", "parts": "release_notes"}).content)
    assert "Platforms" in lean and "Contents of v2" not in lean and "Changes from v1" not in lean
    # Each change coloured: its cell filled and its word in colour (green added, amber updated).
    assert 'w:fill="DDF2E3"' in lean and 'w:val="1E7B34"' in lean and 'w:fill="FCEFC7"' in lean
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


def _preview(client, mdf_id, **layout):
    r = client.post(f"/mdfs/{mdf_id}/summary/preview", json={"from_version": 1, **layout})
    assert r.status_code == 200, r.text
    return r.json()


def _tables(preview):
    """The preview's tables after each heading: {heading: (rows, marks, mark_column)}."""
    out, heading = {}, None
    for b in preview["blocks"]:
        if b["kind"] == "h1":
            heading = b["text"]
        elif b["kind"] == "table":
            out[heading] = (b["rows"], b["marks"], b["mark_column"])
    return out


def test_platforms_and_emitters_tables(editor_client):
    mid = _build(editor_client)
    tables = editor_client.get(f"/mdfs/{mid}/summary", params={"from_version": 1}).json()["tables"]
    # Added first, then updated; values as exported (deltas applied).
    assert [(r["mark"], r["values"]["emitter"]) for r in tables["emitters"]] == [("added", "Radar Two"), ("updated", "Radar One")]
    one = tables["emitters"][1]["values"]
    assert (one["rf"], one["pw"], one["pri"], one["modes"], one["platforms"]) == ("8,995–9,105", "0.4–1.6", "993–1,007", "2", "Alpha Ship")
    assert tables["emitters"][0]["values"]["designation"] == "RT-2"
    assert [(r["mark"], r["values"]["platform"]) for r in tables["platforms"]] == [("added", "Bravo Ship"), ("updated", "Alpha Ship")]
    assert tables["platforms"][0]["values"]["emitters"] == "RT-2 — Radar Two"

    # In the document: the columns asked for, in their own order; a Change column coloured.
    preview = _preview(
        editor_client,
        mid,
        parts=["platforms", "emitters"],
        tables={"platform_columns": ["status", "platform"], "emitter_columns": ["emitter", "rf", "change"], "rows": "all"},
    )
    t = _tables(preview)
    rows, marks, mark_column = t["Emitters in v2"]
    assert rows == [["Emitter", "RF (MHz)", "Change"], ["Radar Two", "8,995–9,105", "Added"], ["Radar One", "8,995–9,105", "Updated"]]
    assert marks == ["added", "updated"] and mark_column == 2
    rows, _, mark_column = t["Platforms in v2"]
    assert rows[0] == ["Platform", "Status"] and mark_column is None
    assert "Contents of v2" not in t and preview["file_name"] == "Log MDF release notes v2.docx"


def test_only_what_changed_and_the_word_file_matches(editor_client):
    mid = _build(editor_client)
    # Unchanged rows are left out with "changed"; the Word file holds the same.
    client = editor_client
    one = client.get(f"/mdfs/{mid}/summary", params={"from_version": 1}).json()
    assert {r["mark"] for r in one["tables"]["emitters"]} == {"added", "updated"}
    layout = {"parts": ["emitters"], "tables": {"emitter_columns": ["designation", "emitter", "status"], "rows": "changed"}}
    t = _tables(_preview(client, mid, **layout))
    rows, _, _ = t["Emitters added or updated in v2"]
    assert [r[1] for r in rows[1:]] == ["Radar Two", "Radar One"]
    doc = _doc(client.post(f"/mdfs/{mid}/summary.docx", json={"from_version": 1, **layout}).content)
    assert "Emitters added or updated in v2" in doc and "RT-2" in doc and "In progress" in doc
    # From the start every row is added.
    t = _tables(_preview(client, mid, base="start", parts=["platforms"], tables={"rows": "changed"}))
    assert [r[0] for r in t["Platforms added or updated in v2"][0][1:]] == ["Alpha Ship", "Bravo Ship"]
    # Unknown columns or rows are refused.
    bad = client.post(f"/mdfs/{mid}/summary/preview", json={"tables": {"emitter_columns": ["colour"]}})
    assert bad.status_code == 422
    assert client.post(f"/mdfs/{mid}/summary/preview", json={"tables": {"rows": "some"}}).status_code == 422
    cols = client.get(f"/mdfs/{mid}/summary/columns").json()
    assert cols["emitters"]["columns"]["rf"] == "RF (MHz)" and "status" in cols["platforms"]["default"]
