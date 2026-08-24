def test_dashboard_counts_reflect_created_entities(editor_client):
    editor_client.post("/emitters", json={"name": "Dash Emitter 1"})
    editor_client.post("/emitters", json={"name": "Dash Emitter 2"})
    editor_client.post("/mdfs", json={"name": "Dash MDF 1"})

    resp = editor_client.get("/dashboard")
    assert resp.status_code == 200
    body = resp.json()
    assert body["emitter_status_counts"]["draft"] >= 2
    assert body["mdf_status_counts"]["draft"] >= 1


def test_dashboard_flags_mdf_needing_attention(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Dash Attn Emitter"}).json()
    v1 = editor_client.post(f"/emitters/{emitter['id']}/versions", json={}).json()
    platform = editor_client.post("/platforms", json={"name": "Dash Attn Platform"}).json()
    editor_client.post(
        f"/platforms/{platform['id']}/links", json={"emitter_id": emitter["id"], "emitter_version_id": v1["id"]}
    )
    platform_v1 = editor_client.post(f"/platforms/{platform['id']}/versions", json={}).json()
    mdf = editor_client.post("/mdfs", json={"name": "Dash Attn MDF"}).json()
    editor_client.post(
        f"/mdfs/{mdf['id']}/links", json={"platform_id": platform["id"], "platform_version_id": platform_v1["id"]}
    )

    resp = editor_client.get("/dashboard")
    assert any("Dash Attn MDF" in item for item in resp.json()["needs_attention"])


def test_viewer_can_read_dashboard(viewer_client):
    resp = viewer_client.get("/dashboard")
    assert resp.status_code == 200
