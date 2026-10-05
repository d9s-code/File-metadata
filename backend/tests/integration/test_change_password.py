from fastapi.testclient import TestClient

from app.main import app as fastapi_app
from app.models.user import User

NEW = "a-brand-new-passphrase"


def _second_session(username: str, password: str) -> TestClient:
    c = TestClient(fastapi_app)
    assert c.post("/auth/login", json={"username": username, "password": password}).status_code == 200
    c.headers.update({"x-csrf-token": c.cookies.get("csrf_token")})
    return c


def test_change_own_password(editor_client, db_override, db_session):
    other = _second_session("editor_t", "editorpass123")

    resp = editor_client.post("/auth/change-password", json={"current_password": "editorpass123", "new_password": NEW})
    assert resp.status_code == 200, resp.text
    # This session carries on (it got a fresh cookie); the other one is signed out.
    editor_client.headers.update({"x-csrf-token": editor_client.cookies.get("csrf_token")})
    assert editor_client.get("/auth/me").status_code == 200
    assert other.get("/auth/me").status_code == 401

    # Only the new password signs in now.
    assert TestClient(fastapi_app).post("/auth/login", json={"username": "editor_t", "password": "editorpass123"}).status_code == 401
    assert TestClient(fastapi_app).post("/auth/login", json={"username": "editor_t", "password": NEW}).status_code == 200

    # Stored as a bcrypt hash, never the password itself.
    db_session.expire_all()
    stored = db_session.query(User).filter(User.username == "editor_t").one().password_hash
    assert stored.startswith("$2b$12$") and NEW not in stored

    summaries = [a["summary"] for a in editor_client.get("/audit-log").json()["items"]]
    assert "'editor_t' changed their password" in summaries


def test_change_password_checks(editor_client):
    wrong = editor_client.post("/auth/change-password", json={"current_password": "not-it-at-all", "new_password": NEW})
    assert wrong.status_code == 400 and "current password" in wrong.json()["detail"]
    same = editor_client.post("/auth/change-password", json={"current_password": "editorpass123", "new_password": "editorpass123"})
    assert same.status_code == 400 and "different" in same.json()["detail"]
    short = editor_client.post("/auth/change-password", json={"current_password": "editorpass123", "new_password": "short"})
    assert short.status_code == 422
    # Guessing the current password runs into the sign-in limit.
    for _ in range(5):
        editor_client.post("/auth/change-password", json={"current_password": "guess-guess-guess", "new_password": NEW})
    assert editor_client.post("/auth/change-password", json={"current_password": "editorpass123", "new_password": NEW}).status_code == 429


def test_change_password_needs_csrf_and_a_session(client, editor_client):
    assert client.post("/auth/change-password", json={"current_password": "x", "new_password": NEW}).status_code in (401, 403)
    editor_client.headers.pop("x-csrf-token")
    assert editor_client.post(
        "/auth/change-password", json={"current_password": "editorpass123", "new_password": NEW}
    ).status_code == 403


def test_admin_reset_signs_the_user_out(admin_client, editor_client):
    editor = next(u for u in admin_client.get("/users").json() if u["username"] == "editor_t")
    assert editor_client.get("/auth/me").status_code == 200
    assert admin_client.patch(f"/users/{editor['id']}", json={"password": NEW}).status_code == 200
    assert editor_client.get("/auth/me").status_code == 401
