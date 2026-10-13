"""Renaming EW Groups and Sources: trimmed, never blank, never another one's name."""


def _audit_summaries(client, entity_type, entity_id):
    data = client.get("/audit-log", params={"entity_type": entity_type, "entity_id": entity_id}).json()
    return [e["summary"] for e in (data["items"] if isinstance(data, dict) else data)]


def test_an_ew_group_can_be_renamed(editor_client):
    e = editor_client.post("/emitters", json={"name": "Rename Groups"}).json()
    base = f"/emitters/{e['id']}/ew-groups"
    g = editor_client.post(base, json={"name": "Search"}).json()
    editor_client.post(base, json={"name": "Track"})

    resp = editor_client.patch(f"{base}/{g['id']}", json={"name": "  Wide Search "})
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Wide Search"
    assert "Renamed EW Group 'Search' to 'Wide Search'" in _audit_summaries(editor_client, "ew_group", g["id"])

    assert editor_client.patch(f"{base}/{g['id']}", json={"name": ""}).status_code == 422
    assert editor_client.patch(f"{base}/{g['id']}", json={"name": "Track"}).status_code == 409
    # Saving its other fields with the same name is fine.
    assert editor_client.patch(f"{base}/{g['id']}", json={"name": "Wide Search", "threat_priority": 2}).status_code == 200


def test_a_source_can_be_renamed(editor_client):
    e = editor_client.post("/emitters", json={"name": "Rename Sources"}).json()
    base = f"/emitters/{e['id']}/sources"
    s = editor_client.post(base, json={"name": "Datasheet", "source_date": "2025-01-01"}).json()
    editor_client.post(base, json={"name": "Lab report", "source_date": "2025-02-01"})

    resp = editor_client.patch(f"{base}/{s['id']}", json={"name": "Datasheet Rev B"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Datasheet Rev B"
    assert "Renamed Source 'Datasheet' to 'Datasheet Rev B'" in _audit_summaries(editor_client, "source", s["id"])

    assert editor_client.patch(f"{base}/{s['id']}", json={"name": "  "}).status_code == 422
    assert editor_client.patch(f"{base}/{s['id']}", json={"name": "Lab report"}).status_code == 409
