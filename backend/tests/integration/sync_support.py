"""The standalone app's "PC" in tests: the same app on a database of its own
(its own schema), which takes a copy from the server, keeps an untouched copy
as the base, is edited through the API like the real thing, and builds what
it sends as the standalone app does."""

import os
from contextlib import contextmanager

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.core.security import hash_password
from app.database import Base, get_db
from app.main import app as fastapi_app
from app.services.sync_service import collect_subtrees, compute_changes, load_copy
from tests.conftest import SCHEMA, SUFFIX
from tests.integration.test_modes_api import FIXED_LINE

_URL = os.environ["DATABASE_URL"]


def _schema_url(schema: str) -> str:
    return _URL.replace(f"search_path%3D{SCHEMA}", f"search_path%3D{schema}")


def make_pc_schemas():
    main = create_engine(_URL)
    engines = {}
    for schema in (f"v2_sync_pc{SUFFIX}", f"v2_sync_base{SUFFIX}"):
        with main.begin() as c:
            c.execute(text(f"DROP SCHEMA IF EXISTS {schema} CASCADE"))
            c.execute(text(f"CREATE SCHEMA {schema}"))
        eng = create_engine(_schema_url(schema))
        Base.metadata.create_all(eng)
        engines[schema] = eng
    return main, engines


def drop_pc_schemas(main, engines):
    for schema, eng in engines.items():
        eng.dispose()
        with main.begin() as c:
            c.execute(text(f"DROP SCHEMA IF EXISTS {schema} CASCADE"))
    main.dispose()


class PC:
    def __init__(self, engines):
        self.engine = engines[f"v2_sync_pc{SUFFIX}"]
        self.base = engines[f"v2_sync_base{SUFFIX}"]

    def take_copy(self, server):
        resp = server.get("/sync/copy")
        assert resp.status_code == 200, resp.text
        copy = resp.json()
        for eng in (self.engine, self.base):
            with eng.begin() as c:
                load_copy(c, copy)
        # As the standalone app does: the copy has no passwords; the PC lets in
        # whoever signed in to the server from it, with its own hash.
        with self.engine.begin() as c:
            c.execute(
                text("UPDATE users SET password_hash = :h WHERE username = 'admin_t'"),
                {"h": hash_password("adminpass123")},
            )

    @contextmanager
    def client(self, username="admin_t", password="adminpass123"):
        """The app as it runs on the PC: the same API, on the PC's database."""
        session = sessionmaker(bind=self.engine, autoflush=False)()
        before = fastapi_app.dependency_overrides.get(get_db)

        def _pc_db():
            yield session

        fastapi_app.dependency_overrides[get_db] = _pc_db
        try:
            c = TestClient(fastapi_app)
            r = c.post("/auth/login", json={"username": username, "password": password})
            assert r.status_code == 200, r.text
            c.headers.update({"x-csrf-token": c.cookies.get("csrf_token")})
            yield c
        finally:
            fastapi_app.dependency_overrides[get_db] = before
            session.close()

    def changes(self) -> dict:
        with self.engine.connect() as local, self.base.connect() as base:
            return compute_changes(local, base)

    def payload(self, server) -> dict:
        """As the standalone app builds it: the changes, plus what's under
        anything the server deleted (its first preview says what)."""
        payload = self.changes()
        r = server.post("/sync/preview", json={"payload": payload})
        assert r.status_code == 200, r.text
        roots = sorted({c["restore"] for g in r.json()["groups"] for c in g["conflicts"] if c.get("restore")})
        if roots:
            with self.engine.connect() as conn:
                payload["subtrees"] = collect_subtrees(conn, roots)
        return payload


def make_emitter(client, name="Sync Radar"):
    e = client.post("/emitters", json={"name": name}).json()
    g = client.post(f"/emitters/{e['id']}/ew-groups", json={"name": "G"}).json()
    s = client.post(f"/emitters/{e['id']}/sources", json={"name": "S", "source_date": "2025-01-01"}).json()
    return e, g, s


def add_mode(client, g, s, name):
    r = client.post(f"/ew-groups/{g['id']}/modes", json={"source_id": s["id"], "name": name, "pri_type": "fixed", "line": FIXED_LINE})
    assert r.status_code == 201, r.text


def mode_names(client, g):
    return sorted(m["name"] for m in client.get(f"/ew-groups/{g['id']}/modes").json())


def sync_apply(server, payload, resolutions=None):
    return server.post("/sync/apply", json={"payload": payload, "resolutions": resolutions or {}, "device": "Field laptop"})
