def test_create_list_update_delete_customer(editor_client):
    resp = editor_client.post("/customers", json={"name": "Acme Corp"})
    assert resp.status_code == 201, resp.text
    customer = resp.json()
    assert customer["name"] == "Acme Corp"

    resp = editor_client.get("/customers")
    assert resp.status_code == 200, resp.text
    assert any(c["id"] == customer["id"] for c in resp.json())

    resp = editor_client.patch(f"/customers/{customer['id']}", json={"name": "Acme Corporation"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Acme Corporation"

    resp = editor_client.delete(f"/customers/{customer['id']}")
    assert resp.status_code == 204, resp.text
    assert not any(c["id"] == customer["id"] for c in editor_client.get("/customers").json())


def test_duplicate_customer_name_rejected(editor_client):
    editor_client.post("/customers", json={"name": "Duplicate Co"})
    resp = editor_client.post("/customers", json={"name": "Duplicate Co"})
    assert resp.status_code == 409


def test_viewer_cannot_create_customer(viewer_client):
    resp = viewer_client.post("/customers", json={"name": "Nope Co"})
    assert resp.status_code == 403


def test_deleting_a_customer_writes_a_snapshot_of_what_was_deleted(editor_client):
    customer = editor_client.post("/customers", json={"name": "Snapshot Co"}).json()
    resp = editor_client.delete(f"/customers/{customer['id']}")
    assert resp.status_code == 204, resp.text

    log = editor_client.get(
        "/audit-log", params={"entity_type": "customer", "entity_id": customer["id"], "action": "delete"}
    ).json()
    assert log["total"] == 1, log
    assert log["items"][0]["changes"]["name"] == "Snapshot Co"


def test_deleting_a_customer_clears_it_from_mdfs(editor_client):
    customer = editor_client.post("/customers", json={"name": "Departing Co"}).json()
    mdf = editor_client.post(
        "/mdfs", json={"name": "MDF With Customer", "customer_id": customer["id"]}
    ).json()
    assert mdf["customer_id"] == customer["id"]

    editor_client.delete(f"/customers/{customer['id']}")

    refetched = editor_client.get(f"/mdfs/{mdf['id']}").json()
    assert refetched["customer_id"] is None
