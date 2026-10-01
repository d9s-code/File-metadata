def test_source_overview_lists_every_source_with_its_group_emitter_and_counts(editor_client, admin_client):
    group = admin_client.post("/source-groups/", json={"name": "Overview Group"}).json()
    emitter = editor_client.post("/emitters", json={"name": "Overview Emitter", "designation": "OV-1"}).json()
    grouped = editor_client.post(
        f"/emitters/{emitter['id']}/sources",
        json={"name": "Grouped Source", "source_date": "2024-03-01", "group_id": group["id"]},
    ).json()
    loose = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Loose Source", "source_date": "2021-07-15"}
    ).json()
    element = editor_client.post(
        f"/emitters/{emitter['id']}/sources/{grouped['id']}/elements",
        json={"element_type": "rf", "value_min": 2900, "value_max": 3100, "delta": 0},
    )
    assert element.status_code == 201, element.text

    resp = editor_client.get("/source-groups/sources")
    assert resp.status_code == 200, resp.text
    rows = {r["id"]: r for r in resp.json()}

    g = rows[grouped["id"]]
    assert (g["group_id"], g["group_name"]) == (group["id"], "Overview Group")
    assert (g["emitter_id"], g["emitter_name"], g["emitter_designation"]) == (emitter["id"], "Overview Emitter", "OV-1")
    assert g["source_date"] == "2024-03-01"
    assert g["updated_at"]
    assert (g["element_count"], g["sequence_count"], g["mode_count"]) == (1, 0, 0)

    l = rows[loose["id"]]
    assert l["group_id"] is None and l["group_name"] is None
    assert l["source_date"] == "2021-07-15"
    assert l["element_count"] == 0


def test_source_overview_leaves_out_deleted_emitters(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Gone Overview Emitter"}).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Gone Source", "source_date": "2020-01-01"}
    ).json()
    editor_client.delete(f"/emitters/{emitter['id']}")
    ids = {r["id"] for r in editor_client.get("/source-groups/sources").json()}
    assert source["id"] not in ids


def test_viewer_can_read_the_overview(viewer_client):
    assert viewer_client.get("/source-groups/sources").status_code == 200
