from fastapi.testclient import TestClient

from app.core.enums import Role
from app.core.rate_limit import _failures
from app.core.security import hash_password
from app.models.user import User


def _make_user(db_session, username: str, password: str) -> User:
    user = User(username=username, password_hash=hash_password(password), role=Role.viewer)
    db_session.add(user)
    db_session.commit()
    return user


def test_login_success_sets_cookies(client: TestClient, db_session):
    _make_user(db_session, "loginok", "correctpass123")

    resp = client.post("/auth/login", json={"username": "loginok", "password": "correctpass123"})

    assert resp.status_code == 200
    assert resp.json()["username"] == "loginok"
    assert client.cookies.get("access_token")
    assert client.cookies.get("csrf_token")


def test_login_wrong_password_is_401(client: TestClient, db_session):
    _make_user(db_session, "loginbad", "correctpass123")

    resp = client.post("/auth/login", json={"username": "loginbad", "password": "wrongpass"})

    assert resp.status_code == 401


def test_login_unknown_user_is_401(client: TestClient):
    resp = client.post("/auth/login", json={"username": "nosuchuser", "password": "whatever123"})

    assert resp.status_code == 401


def test_me_requires_authentication(client: TestClient):
    resp = client.get("/auth/me")

    assert resp.status_code == 401


def test_repeated_failed_logins_are_rate_limited(client: TestClient, db_session):
    _make_user(db_session, "ratelimited", "correctpass123")
    _failures.pop("user:ratelimited", None)

    for _ in range(5):
        resp = client.post("/auth/login", json={"username": "ratelimited", "password": "wrongpass"})
        assert resp.status_code == 401

    locked_resp = client.post("/auth/login", json={"username": "ratelimited", "password": "wrongpass"})
    assert locked_resp.status_code == 429
    assert "Retry-After" in locked_resp.headers

    still_locked_resp = client.post("/auth/login", json={"username": "ratelimited", "password": "correctpass123"})
    assert still_locked_resp.status_code == 429

    _failures.pop("user:ratelimited", None)


def test_successful_login_clears_failure_count(client: TestClient, db_session):
    _make_user(db_session, "resetcounter", "correctpass123")
    _failures.pop("user:resetcounter", None)

    for _ in range(3):
        resp = client.post("/auth/login", json={"username": "resetcounter", "password": "wrongpass"})
        assert resp.status_code == 401

    ok_resp = client.post("/auth/login", json={"username": "resetcounter", "password": "correctpass123"})
    assert ok_resp.status_code == 200
    assert "user:resetcounter" not in _failures


def test_failed_logins_across_usernames_are_rate_limited_per_ip(client: TestClient, monkeypatch):
    from app.core import rate_limit

    monkeypatch.setattr("app.routers.auth.MAX_FAILURES_PER_IP", 3)
    for i in range(3):
        resp = client.post("/auth/login", json={"username": f"spray{i}", "password": "wrongpass"})
        assert resp.status_code == 401
    resp = client.post("/auth/login", json={"username": "spray-next", "password": "wrongpass"})
    assert resp.status_code == 429
    assert rate_limit._failures.get("user:spray-next") is None


def test_username_cannot_poison_an_ip_bucket(client: TestClient):
    from app.core import rate_limit

    client.post("/auth/login", json={"username": "ip:10.9.9.9", "password": "wrongpass"})
    assert "ip:10.9.9.9" not in rate_limit._failures
