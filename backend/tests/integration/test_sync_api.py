"""Syncing the standalone app's offline copy back into the server.

The "PC" is the same app running on a database of its own (its own schema
here): it loads a copy from the server, keeps an untouched copy as the base,
is edited through the API like the real thing, and sends what changed."""

import os
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app as fastapi_app
from app.services.sync_service import compute_changes, load_copy
from tests.integration.test_modes_api import FIXED_LINE

_URL = os.environ["DATABASE_URL"]


def _schema_url(schema: str) -> str:
    return _URL.replace("search_path%3Dv2_test", f"search_path%3D{schema}")


@pytest.fixture(scope="module")
def _pc_schemas():
    main = create_engine(_URL)
    engines = {}
    for schema in ("v2_sync_pc", "v2_sync_base"):
        with main.begin() as c:
            c.execute(text(f"DROP SCHEMA IF EXISTS {schema} CASCADE"))
            c.execute(text(f"CREATE SCHEMA {schema}"))
        eng = create_engine(_schema_url(schema))
        Base.metadata.create_all(eng)
        engines[schema] = eng
    yield engines
    for schema, eng in engines.items():
        eng.dispose()
        with main.begin() as c:
            c.execute(text(f"DROP SCHEMA IF EXISTS {schema} CASCADE"))
    main.dispose()


class PC:
    def __init__(self, engines):
        self.engine = engines["v2_sync_pc"]
        self.base = engines["v2_sync_base"]

    def take_copy(self, server):
        resp = server.get("/sync/copy")
        assert resp.status_code == 200, resp.text
        copy = resp.json()
        for eng in (self.engine, self.base):
            with eng.begin() as c:
                load_copy(c, copy)

    @contextmanager
    def client(self, username="editor_t", password="editorpass123"):
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


@pytest.fixture()
def pc(_pc_schemas, db_session):
    yield PC(_pc_schemas)


def _emitter(client, name="Sync Radar"):
    e = client.post("/emitters", json={"name": name}).json()
    g = client.post(f"/emitters/{e['id']}/ew-groups", json={"name": "G"}).json()
    s = client.post(f"/emitters/{e['id']}/sources", json={"name": "S", "source_date": "2025-01-01"}).json()
    return e, g, s


def _add_mode(client, g, s, name):
    r = client.post(f"/ew-groups/{g['id']}/modes", json={"source_id": s["id"], "name": name, "pri_type": "fixed", "line": FIXED_LINE})
    assert r.status_code == 201, r.text


def _modes(client, g):
    return sorted(m["name"] for m in client.get(f"/ew-groups/{g['id']}/modes").json())


def _sync(server, payload, resolutions=None):
    return server.post("/sync/apply", json={"payload": payload, "resolutions": resolutions or {}, "device": "Field laptop"})


def test_changes_on_both_sides_merge_without_conflict(editor_client, pc):
    server = editor_client
    e, g, s = _emitter(server)
    _add_mode(server, g, s, "A")
    pc.take_copy(server)

    # Offline: a new Mode. On the server meanwhile: a new description.
    with pc.client() as laptop:
        _add_mode(laptop, g, s, "B")
    assert server.patch(f"/emitters/{e['id']}", json={"description": "From the server"}).status_code == 200

    payload = pc.changes()
    preview = server.post("/sync/preview", json={"payload": payload}).json()
    assert preview["unresolved"] == []
    assert not any(gr["conflicts"] for gr in preview["groups"])

    r = _sync(server, payload)
    assert r.status_code == 200, r.text
    assert _modes(server, g) == ["A", "B"]
    assert server.get(f"/emitters/{e['id']}").json()["description"] == "From the server"
    log = server.get("/audit-log", params={"entity_type": "sync"}).json()["items"]
    assert any("Synced changes made offline on Field laptop" in x["summary"] for x in log)


def test_the_same_field_changed_on_both_sides_is_a_conflict_to_settle(editor_client, pc):
    server = editor_client
    e, g, s = _emitter(server)
    pc.take_copy(server)
    with pc.client() as laptop:
        assert laptop.patch(f"/emitters/{e['id']}", json={"description": "PC's words"}).status_code == 200
    server.patch(f"/emitters/{e['id']}", json={"description": "Server's words"})

    payload = pc.changes()
    preview = server.post("/sync/preview", json={"payload": payload}).json()
    group = next(gr for gr in preview["groups"] if gr["key"] == f"emitters:{e['id']}")
    assert group["kind"] == "Emitter" and group["label"] == "Sync Radar"
    field = next(f for c in group["conflicts"] for f in c["fields"] if f["name"] == "description")
    assert (field["server"], field["pc"]) == ("Server's words", "PC's words")

    refused = _sync(server, payload)
    assert refused.status_code == 409
    assert server.get(f"/emitters/{e['id']}").json()["description"] == "Server's words"

    assert _sync(server, payload, {group["key"]: "pc"}).status_code == 200
    assert server.get(f"/emitters/{e['id']}").json()["description"] == "PC's words"


def test_server_wins_keeps_its_value_but_takes_the_rest(editor_client, pc):
    server = editor_client
    e, g, s = _emitter(server)
    pc.take_copy(server)
    with pc.client() as laptop:
        laptop.patch(f"/emitters/{e['id']}", json={"description": "PC's words"})
        _add_mode(laptop, g, s, "Offline mode")
    server.patch(f"/emitters/{e['id']}", json={"description": "Server's words"})

    r = _sync(server, pc.changes(), {f"emitters:{e['id']}": "server"})
    assert r.status_code == 200, r.text
    assert server.get(f"/emitters/{e['id']}").json()["description"] == "Server's words"
    assert _modes(server, g) == ["Offline mode"]


def test_a_version_number_both_sides_used_is_renumbered(editor_client, pc):
    server = editor_client
    e, g, s = _emitter(server)
    _add_mode(server, g, s, "A")
    assert server.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"}).status_code == 201
    pc.take_copy(server)

    with pc.client() as laptop:
        _add_mode(laptop, g, s, "PC mode")
        assert laptop.post(f"/emitters/{e['id']}/versions", json={"change_summary": "saved offline"}).status_code == 201
    _add_mode(server, g, s, "Server mode")
    assert server.post(f"/emitters/{e['id']}/versions", json={"change_summary": "saved on the server"}).status_code == 201

    payload = pc.changes()
    preview = server.post("/sync/preview", json={"payload": payload}).json()
    resolutions = {gr["key"]: "pc" for gr in preview["groups"] if gr["conflicts"]}
    r = _sync(server, payload, resolutions)
    assert r.status_code == 200, r.text
    assert any("v2 is v3" in n for n in r.json()["notes"])
    versions = {v["version_number"]: v["change_summary"] for v in server.get(f"/emitters/{e['id']}/versions").json()}
    assert versions == {1: "v1", 2: "saved on the server", 3: "saved offline"}
    assert _modes(server, g) == ["A", "PC mode", "Server mode"]


def test_a_name_both_sides_gave_a_new_emitter_is_kept_apart(editor_client, pc):
    server = editor_client
    pc.take_copy(server)
    with pc.client() as laptop:
        _emitter(laptop, "Harbour Radar")
    _emitter(server, "Harbour Radar")

    r = _sync(server, pc.changes())
    assert r.status_code == 200, r.text
    names = sorted(x["name"] for x in server.get("/emitters").json())
    assert names == ["Harbour Radar", "Harbour Radar (from PC)"]


def test_a_mode_added_under_a_group_the_server_deleted(editor_client, pc):
    server = editor_client
    e, g, s = _emitter(server)
    pc.take_copy(server)
    with pc.client() as laptop:
        _add_mode(laptop, g, s, "Orphan")
    assert server.delete(f"/emitters/{e['id']}/ew-groups/{g['id']}").status_code == 204

    payload = pc.changes()
    preview = server.post("/sync/preview", json={"payload": payload}).json()
    kinds = {c["kind"] for gr in preview["groups"] for c in gr["conflicts"]}
    assert "parent_deleted" in kinds

    # The server wins: the Mode doesn't come over, and nothing else breaks.
    keys = {gr["key"]: "server" for gr in preview["groups"] if gr["conflicts"]}
    r = _sync(server, payload, keys)
    assert r.status_code == 200, r.text
    assert server.get(f"/ew-groups/{g['id']}/modes").status_code == 404

    # The PC wins: the group comes back from the PC's copy, with the Mode.
    keys = {k: "pc" for k in keys}
    assert _sync(server, payload, keys).status_code == 200
    assert _modes(server, g) == ["Orphan"]


def test_a_different_app_version_is_refused(editor_client, pc):
    pc.take_copy(editor_client)
    payload = pc.changes()
    payload["schema"] = "some-other-version"
    r = editor_client.post("/sync/preview", json={"payload": payload})
    assert r.status_code == 409
    assert "different version" in r.json()["detail"]


def test_a_viewer_cannot_take_a_copy(viewer_client):
    assert viewer_client.get("/sync/copy").status_code == 403
