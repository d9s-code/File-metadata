def test_creating_an_emitter_writes_an_audit_entry(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Audited Emitter"}).json()

    resp = editor_client.get("/audit-log", params={"entity_type": "emitter", "entity_id": emitter["id"]})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 1
    entry = body["items"][0]
    assert entry["action"] == "create"
    assert entry["entity_type"] == "emitter"
    assert entry["entity_id"] == emitter["id"]
    assert "Audited Emitter" in entry["summary"]
    assert entry["changes"]["name"] == "Audited Emitter"
    assert entry["actor_username"] == "editor_t"


def test_updating_and_deleting_an_emitter_each_write_an_entry(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Lifecycle Emitter"}).json()
    editor_client.patch(f"/emitters/{emitter['id']}", json={"description": "updated desc"})
    editor_client.delete(f"/emitters/{emitter['id']}")

    resp = editor_client.get("/audit-log", params={"entity_type": "emitter", "entity_id": emitter["id"]})
    actions = [e["action"] for e in resp.json()["items"]]
    # Newest first.
    assert actions == ["delete", "update", "create"]


def test_status_transition_writes_a_status_change_entry(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Status Emitter"}).json()
    editor_client.post(f"/emitters/{emitter['id']}/versions", json={})
    editor_client.post(f"/emitters/{emitter['id']}/status", json={"new_status": "in_review"})

    resp = editor_client.get("/audit-log", params={"entity_type": "emitter", "action": "status_change"})
    items = [e for e in resp.json()["items"] if e["entity_id"] == emitter["id"]]
    assert len(items) == 1
    assert "draft" in items[0]["summary"] and "in_review" in items[0]["summary"]


def test_deleting_a_mode_writes_an_entry(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Mode Audit Emitter"}).json()
    ew_group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Group A"}).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Source A", "source_date": "2025-01-01"}
    ).json()
    line = {
        "rf_min_mhz": 2900,
        "rf_max_mhz": 3100,
        "pw_min_us": 0.5,
        "pw_max_us": 1.2,
        "pri_min_us": 800,
        "pri_max_us": 1200,
        "jitter_min_us": 5,
        "jitter_max_us": 15,
        "rf_delta": 1,
        "pw_delta": 0.05,
        "pri_delta": 10,
        "rf_range_matching": False,
        "pw_range_matching": False,
        "pri_range_matching": False,
    }
    mode = editor_client.post(
        f"/ew-groups/{ew_group['id']}/modes",
        json={"source_id": source["id"], "name": "Audited Mode", "pri_type": "fixed", "line": line},
    ).json()
    editor_client.delete(f"/ew-groups/{ew_group['id']}/modes/{mode['id']}")

    resp = editor_client.get("/audit-log", params={"entity_type": "mode", "entity_id": mode["id"]})
    actions = [e["action"] for e in resp.json()["items"]]
    assert actions == ["delete", "create"]


def test_login_success_and_failure_are_audited(client):
    resp = client.post("/auth/login", json={"username": "nobody", "password": "wrong"})
    assert resp.status_code == 401

    admin = client.post("/auth/login", json={"username": "does-not-exist", "password": "x"})
    assert admin.status_code == 401


def test_user_create_and_update_do_not_leak_password_into_audit_changes(admin_client):
    resp = admin_client.post("/users", json={"username": "audited_user", "password": "s3cret-password", "role": "viewer"})
    assert resp.status_code == 201, resp.text
    user_id = resp.json()["id"]

    admin_client.patch(f"/users/{user_id}", json={"password": "new-s3cret", "role": "editor"})

    log = admin_client.get("/audit-log", params={"entity_type": "user", "entity_id": user_id}).json()
    dump = str(log)
    assert "s3cret-password" not in dump
    assert "new-s3cret" not in dump
    update_entry = next(e for e in log["items"] if e["action"] == "update")
    assert update_entry["changes"]["password"] == "changed"
    assert update_entry["changes"]["role"]["new"] == "editor"


def test_entity_type_and_action_facet_counts(editor_client):
    editor_client.post("/emitters", json={"name": "Facet Emitter"})

    entity_types = {row["entity_type"]: row["count"] for row in editor_client.get("/audit-log/entity-types").json()}
    assert entity_types["emitter"] >= 1
    assert "user" in entity_types  # zero-count groups are still listed

    actions = {row["action"]: row["count"] for row in editor_client.get("/audit-log/actions", params={"entity_type": "emitter"}).json()}
    assert actions["create"] >= 1


def test_free_text_search_over_summary(editor_client):
    editor_client.post("/emitters", json={"name": "SearchableUniqueName123"})
    resp = editor_client.get("/audit-log", params={"q": "SearchableUniqueName123"})
    assert resp.json()["total"] == 1
