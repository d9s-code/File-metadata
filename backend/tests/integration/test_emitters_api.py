def test_editor_can_create_emitter(editor_client):
    resp = editor_client.post("/emitters", json={"name": "AN/APG-99", "designation": "SPEAR EYE"})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "AN/APG-99"
    assert body["status"] == "draft"
    assert body["is_deleted"] is False


def test_viewer_cannot_create_emitter(viewer_client):
    resp = viewer_client.post("/emitters", json={"name": "Nope"})
    assert resp.status_code == 403


def test_viewer_can_list_emitters(editor_client, viewer_client):
    editor_client.post("/emitters", json={"name": "Listed Emitter"})
    resp = viewer_client.get("/emitters")
    assert resp.status_code == 200
    assert any(e["name"] == "Listed Emitter" for e in resp.json())


def test_mutating_request_without_csrf_header_is_rejected(editor_client):
    del editor_client.headers["x-csrf-token"]
    resp = editor_client.post("/emitters", json={"name": "No CSRF"})
    assert resp.status_code == 403


def test_duplicate_emitter_name_rejected(editor_client):
    editor_client.post("/emitters", json={"name": "Dup Name"})
    resp = editor_client.post("/emitters", json={"name": "Dup Name"})
    assert resp.status_code == 409


def test_soft_delete_hides_from_default_list(editor_client):
    created = editor_client.post("/emitters", json={"name": "To Delete"}).json()
    resp = editor_client.delete(f"/emitters/{created['id']}")
    assert resp.status_code == 204

    listed = editor_client.get("/emitters").json()
    assert all(e["id"] != created["id"] for e in listed)

    listed_with_deleted = editor_client.get("/emitters?include_deleted=true").json()
    assert any(e["id"] == created["id"] and e["is_deleted"] for e in listed_with_deleted)


def test_hard_delete_requires_admin(editor_client, admin_client):
    created = editor_client.post("/emitters", json={"name": "Hard Delete Target"}).json()

    resp = editor_client.delete(f"/emitters/{created['id']}?hard=true")
    assert resp.status_code == 403

    resp = admin_client.delete(f"/emitters/{created['id']}?hard=true")
    assert resp.status_code == 204
    assert admin_client.get(f"/emitters/{created['id']}").status_code == 404
