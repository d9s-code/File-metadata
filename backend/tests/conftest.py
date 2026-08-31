import os

os.environ["DATABASE_URL"] = "postgresql+psycopg2://rf_app:rf_app_dev_pw@localhost:5432/rf_emitter_test"
os.environ["COOKIE_SECURE"] = "false"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

import app.models  # noqa: F401
from app.core.enums import Role
from app.core.security import hash_password
from app.database import Base, get_db
from app.main import app as fastapi_app
from app.models.user import User

engine = create_engine(os.environ["DATABASE_URL"])
TestSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


@pytest.fixture(scope="session", autouse=True)
def _create_schema():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def db_session():
    # Each test gets its own Session; routes are free to call db.commit() as
    # they do in real request handling. Isolation between tests comes from
    # truncating everything afterwards, not from an outer rolled-back
    # transaction (which real commits inside route handlers would break).
    session = TestSessionLocal()
    try:
        yield session
    finally:
        session.close()
        with engine.begin() as conn:
            table_names = ", ".join(f'"{t.name}"' for t in reversed(Base.metadata.sorted_tables))
            conn.execute(text(f"TRUNCATE {table_names} RESTART IDENTITY CASCADE"))


@pytest.fixture()
def db_override(db_session):
    def _override_get_db():
        yield db_session

    fastapi_app.dependency_overrides[get_db] = _override_get_db
    yield
    fastapi_app.dependency_overrides.clear()


@pytest.fixture()
def client(db_override):
    # Each caller of this fixture gets an independent TestClient instance
    # (own cookie jar), so logging in as one role never clobbers another
    # role's session within the same test.
    with TestClient(fastapi_app) as c:
        yield c


def _new_authenticated_client(db_override, username: str, password: str) -> TestClient:
    c = TestClient(fastapi_app)
    resp = c.post("/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    c.headers.update({"x-csrf-token": c.cookies.get("csrf_token")})
    return c


@pytest.fixture()
def admin_client(db_override, db_session):
    user = User(username="admin_t", password_hash=hash_password("adminpass123"), role=Role.admin)
    db_session.add(user)
    db_session.commit()
    return _new_authenticated_client(db_override, "admin_t", "adminpass123")


@pytest.fixture()
def editor_client(db_override, db_session):
    user = User(username="editor_t", password_hash=hash_password("editorpass123"), role=Role.editor)
    db_session.add(user)
    db_session.commit()
    return _new_authenticated_client(db_override, "editor_t", "editorpass123")


@pytest.fixture()
def viewer_client(db_override, db_session):
    user = User(username="viewer_t", password_hash=hash_password("viewerpass123"), role=Role.viewer)
    db_session.add(user)
    db_session.commit()
    return _new_authenticated_client(db_override, "viewer_t", "viewerpass123")
