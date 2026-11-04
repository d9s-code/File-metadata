"""Syncing the standalone app's offline copy back into the server.

The "PC" is the same app running on a database of its own (its own schema
here): it loads a copy from the server, keeps an untouched copy as the base,
is edited through the API like the real thing, and sends what changed."""

from app.core.security import verify_password
from tests.integration.sync_support import add_mode as _add_mode
from tests.integration.sync_support import make_emitter as _emitter
from tests.integration.sync_support import mode_names as _modes
from tests.integration.sync_support import sync_apply as _sync



def test_changes_on_both_sides_merge_without_conflict(admin_client, pc):
    server = admin_client
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


def test_the_same_field_changed_on_both_sides_is_a_conflict_to_settle(admin_client, pc):
    server = admin_client
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


def test_server_wins_keeps_its_value_but_takes_the_rest(admin_client, pc):
    server = admin_client
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


def test_a_version_number_both_sides_used_is_renumbered(admin_client, pc):
    server = admin_client
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


def test_a_name_both_sides_gave_a_new_emitter_is_kept_apart(admin_client, pc):
    server = admin_client
    pc.take_copy(server)
    with pc.client() as laptop:
        _emitter(laptop, "Harbour Radar")
    _emitter(server, "Harbour Radar")

    r = _sync(server, pc.changes())
    assert r.status_code == 200, r.text
    names = sorted(x["name"] for x in server.get("/emitters").json())
    assert names == ["Harbour Radar", "Harbour Radar (from PC)"]


def test_a_mode_added_under_a_group_the_server_deleted(admin_client, pc):
    server = admin_client
    e, g, s = _emitter(server)
    pc.take_copy(server)
    with pc.client() as laptop:
        _add_mode(laptop, g, s, "Orphan")
    assert server.delete(f"/emitters/{e['id']}/ew-groups/{g['id']}").status_code == 204

    payload = pc.payload(server)
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


def test_a_different_app_version_is_refused(admin_client, pc):
    pc.take_copy(admin_client)
    payload = pc.changes()
    payload["schema"] = "some-other-version"
    r = admin_client.post("/sync/preview", json={"payload": payload})
    assert r.status_code == 409
    assert "different version" in r.json()["detail"]


def test_only_an_admin_can_take_a_copy_or_sync(viewer_client, editor_client):
    assert viewer_client.get("/sync/copy").status_code == 403
    assert editor_client.get("/sync/copy").status_code == 403
    assert editor_client.post("/sync/preview", json={"payload": {"changes": []}}).status_code == 403


def test_rows_round_trip_with_str_enums():
    """An enum that's also a str (TestResult.pass_ is "pass") travels by its name."""
    from app.database import Base
    from app.core.enums import TestResult
    from app.services.sync_service import _dump, load_row

    t = Base.metadata.tables["test_records"]
    assert _dump(TestResult.pass_) == "pass_"
    assert load_row(t, {"result": "pass_"})["result"] is TestResult.pass_
    assert load_row(t, {"result": "pass"})["result"] is TestResult.pass_


def test_the_copy_carries_no_passwords(editor_client, admin_client):
    """Whoever takes a copy mustn't get everyone's password hashes."""
    copy = admin_client.get("/sync/copy").json()
    users = copy["tables"]["users"]
    assert {u["username"] for u in users} >= {"editor_t", "admin_t"}
    hashes = {u["password_hash"] for u in users}
    assert len(hashes) == 1  # one locked hash for everyone, of a random secret
    locked = hashes.pop()
    assert not verify_password("editorpass123", locked) and not verify_password("adminpass123", locked)
