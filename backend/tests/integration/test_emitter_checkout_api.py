def test_create_emitter_auto_checks_out_to_creator(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Checkout Emitter"}).json()
    assert emitter["checked_out_by_id"] is not None
    assert emitter["checked_out_at"] is not None


def test_second_editor_cannot_check_out_while_held(editor_client, admin_client):
    emitter = editor_client.post("/emitters", json={"name": "Locked Emitter"}).json()
    resp = admin_client.post(f"/emitters/{emitter['id']}/checkout")
    assert resp.status_code == 409


def test_second_editor_cannot_edit_while_checked_out(editor_client, admin_client):
    emitter = editor_client.post("/emitters", json={"name": "Edit Locked Emitter"}).json()
    resp = admin_client.patch(f"/emitters/{emitter['id']}", json={"description": "sneaky edit"})
    assert resp.status_code == 409


def test_holder_can_check_out_again_idempotently(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Idempotent Checkout"}).json()
    resp = editor_client.post(f"/emitters/{emitter['id']}/checkout")
    assert resp.status_code == 200, resp.text


def test_holder_can_check_in(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Checkin Emitter"}).json()
    resp = editor_client.delete(f"/emitters/{emitter['id']}/checkout")
    assert resp.status_code == 200, resp.text
    assert resp.json()["checked_out_by_id"] is None


def test_non_holder_editor_cannot_check_in(editor_client, db_session, db_override):
    from fastapi.testclient import TestClient

    from app.core.enums import Role
    from app.core.security import hash_password
    from app.main import app as fastapi_app
    from app.models.user import User

    emitter = editor_client.post("/emitters", json={"name": "Checkin Guard Emitter"}).json()

    other_editor = User(username="other_editor", password_hash=hash_password("otherpass123"), role=Role.editor)
    db_session.add(other_editor)
    db_session.commit()
    other_client = TestClient(fastapi_app)
    other_client.post("/auth/login", json={"username": "other_editor", "password": "otherpass123"})
    other_client.headers.update({"x-csrf-token": other_client.cookies.get("csrf_token")})

    resp = other_client.delete(f"/emitters/{emitter['id']}/checkout")
    assert resp.status_code == 403


def test_admin_can_force_release_checkout(editor_client, admin_client):
    emitter = editor_client.post("/emitters", json={"name": "Force Release Emitter"}).json()

    # The admin isn't the holder (the editor is) -> normally 403, but admin
    # has an explicit escape hatch for a stale lock.
    resp = admin_client.delete(f"/emitters/{emitter['id']}/checkout")
    assert resp.status_code == 200, resp.text
    assert resp.json()["checked_out_by_id"] is None

    # Now free for anyone (including the admin) to check out.
    resp2 = admin_client.post(f"/emitters/{emitter['id']}/checkout")
    assert resp2.status_code == 200, resp2.text


def test_checkin_when_not_checked_out_is_409(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Not Checked Out Emitter"}).json()
    editor_client.delete(f"/emitters/{emitter['id']}/checkout")
    resp = editor_client.delete(f"/emitters/{emitter['id']}/checkout")
    assert resp.status_code == 409


def test_child_mutations_require_checkout(editor_client, admin_client):
    emitter = editor_client.post("/emitters", json={"name": "Child Gate Emitter"}).json()
    resp = admin_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Blocked Group"})
    assert resp.status_code == 409

    resp2 = admin_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Blocked Source", "source_date": "2025-01-01"}
    )
    assert resp2.status_code == 409


def test_mode_mutations_require_emitters_checkout(editor_client, admin_client):
    emitter = editor_client.post("/emitters", json={"name": "Mode Gate Emitter"}).json()
    ew_group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Group M"}).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Source M", "source_date": "2025-01-01"}
    ).json()

    FIXED_LINE = {
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
    resp = admin_client.post(
        f"/ew-groups/{ew_group['id']}/modes",
        json={"source_id": source["id"], "name": "Blocked Mode", "pri_type": "fixed", "line": FIXED_LINE},
    )
    assert resp.status_code == 409
