"""The threat priority overview: every EW Group of every Emitter, and a bulk
change that follows the editing rules (checks out free Emitters to you)."""


def _emitter(client, name, groups):
    e = client.post("/emitters", json={"name": name}).json()
    out = [client.post(f"/emitters/{e['id']}/ew-groups", json={"name": g, "threat_priority": p}).json() for g, p in groups]
    client.delete(f"/emitters/{e['id']}/checkout")
    return e, out


def test_lists_every_ew_group_with_its_emitter_and_platforms(editor_client):
    e, (search, track) = _emitter(editor_client, "TP Radar One", [("Search", 3), ("Track", None)])
    editor_client.post(f"/emitters/{e['id']}/checkout")
    v = editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"}).json()
    editor_client.delete(f"/emitters/{e['id']}/checkout")
    platform = editor_client.post("/platforms", json={"name": "TP Frigate", "allegiance": "hostile"}).json()
    editor_client.post(f"/platforms/{platform['id']}/links", json={"emitter_id": e["id"], "emitter_version_id": v["id"]})

    rows = {r["ew_group_id"]: r for r in editor_client.get("/threat-priorities").json()}
    assert rows[search["id"]]["threat_priority"] == 3
    assert rows[track["id"]]["threat_priority"] is None
    assert rows[search["id"]]["emitter_name"] == "TP Radar One"
    assert rows[search["id"]]["platforms"] == [{"id": platform["id"], "name": "TP Frigate", "allegiance": "hostile"}]
    assert rows[search["id"]]["checked_out_by_id"] is None


def test_a_bulk_change_checks_out_free_emitters_and_is_audited(editor_client):
    a, (ga,) = _emitter(editor_client, "TP Radar Two", [("Search", 1)])
    b, (gb,) = _emitter(editor_client, "TP Radar Three", [("Search", 2)])
    resp = editor_client.post(
        "/threat-priorities",
        json={"changes": [{"ew_group_id": ga["id"], "threat_priority": 9}, {"ew_group_id": gb["id"], "threat_priority": 2}]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"updated": 1, "unchanged": 1, "started_editing": ["TP Radar Three", "TP Radar Two"]}
    rows = {r["ew_group_id"]: r for r in editor_client.get("/threat-priorities").json()}
    assert rows[ga["id"]]["threat_priority"] == 9
    assert rows[ga["id"]]["checked_out_by_id"] is not None
    audit = editor_client.get("/audit-log", params={"emitter_id": a["id"]}).json()["items"]
    assert any("threat priority" in x["summary"] for x in audit)
    assert any(x["summary"].startswith("Started editing Emitter 'TP Radar Two'") for x in audit)
    # Clearing it.
    resp = editor_client.post("/threat-priorities", json={"changes": [{"ew_group_id": ga["id"], "threat_priority": None}]})
    assert resp.json()["updated"] == 1


def test_refuses_an_emitter_someone_else_is_editing(editor_client, admin_client):
    e, (g,) = _emitter(editor_client, "TP Radar Four", [("Search", 1)])
    admin_client.post(f"/emitters/{e['id']}/checkout")
    resp = editor_client.post("/threat-priorities", json={"changes": [{"ew_group_id": g["id"], "threat_priority": 5}]})
    assert resp.status_code == 409
    assert "TP Radar Four" in resp.json()["detail"]
    # Without start_editing, a free one is refused too.
    e2, (g2,) = _emitter(editor_client, "TP Radar Five", [("Search", 1)])
    resp = editor_client.post(
        "/threat-priorities", json={"changes": [{"ew_group_id": g2["id"], "threat_priority": 5}], "start_editing": False}
    )
    assert resp.status_code == 409


def test_viewers_read_but_dont_change(viewer_client, editor_client):
    _, (g,) = _emitter(editor_client, "TP Radar Six", [("Search", 1)])
    assert viewer_client.get("/threat-priorities").status_code == 200
    assert viewer_client.post("/threat-priorities", json={"changes": [{"ew_group_id": g["id"], "threat_priority": 2}]}).status_code == 403
