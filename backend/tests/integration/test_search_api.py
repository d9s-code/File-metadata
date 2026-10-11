"""Quick-jump search across the repository."""

from tests.integration.test_modes_api import FIXED_LINE


def test_search_finds_each_kind_by_every_word(editor_client):
    e = editor_client.post("/emitters", json={"name": "Searchable Radar", "designation": "SR-9"}).json()
    g = editor_client.post(f"/emitters/{e['id']}/ew-groups", json={"name": "Track"}).json()
    s = editor_client.post(
        f"/emitters/{e['id']}/sources", json={"name": "Searchable datasheet", "source_date": "2025-01-01"}
    ).json()
    editor_client.post(
        f"/ew-groups/{g['id']}/modes",
        json={"source_id": s["id"], "name": "Searchable track mode", "pri_type": "fixed", "line": FIXED_LINE},
    )
    editor_client.post("/platforms", json={"name": "Searchable Frigate"})
    editor_client.post("/mdfs", json={"name": "Searchable Release"})

    hits = editor_client.get("/search", params={"q": "searchable"}).json()
    kinds = {h["kind"] for h in hits}
    assert {"emitter", "mode", "source", "platform", "mdf"} <= kinds
    emitter_hit = next(h for h in hits if h["kind"] == "emitter")
    assert emitter_hit["title"] == "SR-9 — Searchable Radar"
    assert emitter_hit["url"] == f"/emitters/{e['id']}"
    mode_hit = next(h for h in hits if h["kind"] == "mode")
    assert mode_hit["url"].startswith(f"/emitters/{e['id']}?tab=modes")

    # Every word must match, in any order; the designation counts for an Emitter.
    assert [h["title"] for h in editor_client.get("/search", params={"q": "radar sr-9"}).json() if h["kind"] == "emitter"] == [
        "SR-9 — Searchable Radar"
    ]
    assert not [h for h in editor_client.get("/search", params={"q": "searchable zzz"}).json()]
    assert editor_client.get("/search", params={"q": "  "}).json() == []


def test_search_leaves_out_deleted_emitters(editor_client):
    e = editor_client.post("/emitters", json={"name": "Gone Searchable"}).json()
    editor_client.delete(f"/emitters/{e['id']}")
    assert not [h for h in editor_client.get("/search", params={"q": "gone searchable"}).json() if h["kind"] == "emitter"]
