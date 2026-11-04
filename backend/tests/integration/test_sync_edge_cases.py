"""Syncing an offline copy back: the awkward cases.

Each test runs the real app twice — the server, and the "PC" on a database of
its own that took a copy — changes things on both, and syncs."""

import time
import uuid

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.emitter import Emitter
from app.models.emitter_note import EmitterNote
from app.models.user import User
from tests.integration.test_modes_api import FIXED_LINE
from tests.integration.sync_support import add_mode as _add_mode
from tests.integration.sync_support import make_emitter as _emitter
from tests.integration.sync_support import mode_names as _modes
from tests.integration.sync_support import sync_apply as _sync

STAGGER_LINE = {
    "rf_min_mhz": 2900.125,
    "rf_max_mhz": 3100.5,
    "pw_min_us": 0.5,
    "pw_max_us": 1.25,
    "rf_delta": 1.5,
    "pw_delta": 0.05,
    "pri_stagger_values_us": [800.125, 850, 900.5, 780.0625],
    "frame_time_delta_us": 10,
    "rf_range_matching": False,
    "pw_range_matching": False,
    "pri_range_matching": False,
}


def _mode_id(client, g, name):
    return next(m["id"] for m in client.get(f"/ew-groups/{g['id']}/modes").json() if m["name"] == name)


def _choose(server, payload, side):
    preview = server.post("/sync/preview", json={"payload": payload}).json()
    return {gr["key"]: side for gr in preview["groups"] if gr["conflicts"]}


def _versions(client, e):
    return {v["version_number"]: v["change_summary"] for v in client.get(f"/emitters/{e['id']}/versions").json()}


def test_syncing_again_after_a_sync_that_broke_off_changes_nothing(admin_client, pc):
    """The server took the changes but the PC never heard back (the network
    dropped): syncing the same again must not duplicate or clash."""
    server = admin_client
    e, g, s = _emitter(server)
    _add_mode(server, g, s, "A")
    server.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"})
    pc.take_copy(server)
    with pc.client() as laptop:
        _add_mode(laptop, g, s, "PC mode")
        laptop.post(f"/emitters/{e['id']}/versions", json={"change_summary": "offline v2"})
        _emitter(laptop, "Harbour")
    _add_mode(server, g, s, "Server mode")
    server.post(f"/emitters/{e['id']}/versions", json={"change_summary": "server v2"})
    _emitter(server, "Harbour")

    payload = pc.payload(server)
    choices = _choose(server, payload, "pc")
    first = _sync(server, payload, choices)
    assert first.status_code == 200, first.text
    before = (_versions(server, e), sorted(x["name"] for x in server.get("/emitters").json()), _modes(server, g))
    assert before[0] == {1: "v1", 2: "server v2", 3: "offline v2"}

    again = _sync(server, payload, choices)
    assert again.status_code == 200, again.text
    assert again.json()["applied"].get("insert", 0) == 0
    after = (_versions(server, e), sorted(x["name"] for x in server.get("/emitters").json()), _modes(server, g))
    assert after == before

    # And work carried on on the PC since (it never fetched): only that goes over.
    with pc.client() as laptop:
        laptop.patch(f"/emitters/{e['id']}", json={"description": "Later, still offline"})
    later = pc.payload(server)
    preview = server.post("/sync/preview", json={"payload": later}).json()
    assert not any(gr["conflicts"] for gr in preview["groups"]), preview
    assert _sync(server, later).status_code == 200
    assert server.get(f"/emitters/{e['id']}").json()["description"] == "Later, still offline"
    assert _versions(server, e) == before[0]


def test_two_versions_and_checkpoints_offline_against_one_version_on_the_server(admin_client, pc):
    server = admin_client
    e, g, s = _emitter(server)
    _add_mode(server, g, s, "A")
    server.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"})
    pc.take_copy(server)
    with pc.client() as laptop:
        _add_mode(laptop, g, s, "B")
        assert laptop.post(f"/emitters/{e['id']}/versions", json={"change_summary": "pc v2"}).status_code == 201
        _add_mode(laptop, g, s, "C")
        assert laptop.post(f"/emitters/{e['id']}/checkpoints", json={"change_summary": "pc 2.1"}).status_code == 201
        assert laptop.post(f"/emitters/{e['id']}/versions", json={"change_summary": "pc v3"}).status_code == 201
        _add_mode(laptop, g, s, "D")
        assert laptop.post(f"/emitters/{e['id']}/checkpoints", json={"change_summary": "pc 3.1"}).status_code == 201
    _add_mode(server, g, s, "S")
    server.post(f"/emitters/{e['id']}/versions", json={"change_summary": "server v2"})

    payload = pc.payload(server)
    r = _sync(server, payload, _choose(server, payload, "pc"))
    assert r.status_code == 200, r.text
    assert _versions(server, e) == {1: "v1", 2: "server v2", 3: "pc v2", 4: "pc v3"}
    # Each checkpoint follows its version: 2.1 → 3.1, 3.1 → 4.1 — not moved twice.
    history = {h["ref"]: h["change_summary"] for h in server.get(f"/emitters/{e['id']}/history").json()}
    assert history["3.1"] == "pc 2.1" and history["4.1"] == "pc 3.1"
    assert "2.1" not in history


def test_both_sides_deleted_the_same_mode(admin_client, pc):
    server = admin_client
    e, g, s = _emitter(server)
    _add_mode(server, g, s, "A")
    _add_mode(server, g, s, "B")
    pc.take_copy(server)
    a = _mode_id(server, g, "A")
    with pc.client() as laptop:
        assert laptop.delete(f"/ew-groups/{g['id']}/modes/{a}").status_code == 204
    assert server.delete(f"/ew-groups/{g['id']}/modes/{a}").status_code == 204

    payload = pc.payload(server)
    preview = server.post("/sync/preview", json={"payload": payload}).json()
    assert not any(gr["conflicts"] for gr in preview["groups"])
    assert _sync(server, payload).status_code == 200
    assert _modes(server, g) == ["B"]


def test_a_mode_deleted_offline_goes(admin_client, pc):
    server = admin_client
    e, g, s = _emitter(server)
    _add_mode(server, g, s, "A")
    _add_mode(server, g, s, "B")
    pc.take_copy(server)
    with pc.client() as laptop:
        assert laptop.delete(f"/ew-groups/{g['id']}/modes/{_mode_id(laptop, g, 'A')}").status_code == 204
    assert _sync(server, pc.payload(server)).status_code == 200
    assert _modes(server, g) == ["B"]


def test_a_group_deleted_offline_that_the_server_added_to(admin_client, pc):
    server = admin_client
    e, g, s = _emitter(server)
    _add_mode(server, g, s, "A")
    pc.take_copy(server)
    with pc.client() as laptop:
        assert laptop.delete(f"/emitters/{e['id']}/ew-groups/{g['id']}").status_code == 204
    _add_mode(server, g, s, "Added on the server")

    payload = pc.payload(server)
    preview = server.post("/sync/preview", json={"payload": payload}).json()
    assert any(c["kind"] == "pc_deleted" for gr in preview["groups"] for c in gr["conflicts"])

    # The server's kept: the group stays, with both Modes.
    assert _sync(server, payload, _choose(server, payload, "server")).status_code == 200
    assert _modes(server, g) == ["A", "Added on the server"]
    # The PC's kept: the group goes, and what's under it.
    assert _sync(server, payload, _choose(server, payload, "pc")).status_code == 200
    assert server.get(f"/ew-groups/{g['id']}/modes").status_code == 404


def test_keeping_the_pcs_mode_the_server_deleted_brings_it_back_whole(admin_client, pc):
    server = admin_client
    e, g, s = _emitter(server)
    _add_mode(server, g, s, "A")
    pc.take_copy(server)
    a = _mode_id(server, g, "A")
    with pc.client() as laptop:
        assert laptop.patch(f"/ew-groups/{g['id']}/modes/{a}", json={"name": "A renamed offline"}).status_code == 200
        pc_mode = laptop.get(f"/ew-groups/{g['id']}/modes").json()[0]
    assert server.delete(f"/ew-groups/{g['id']}/modes/{a}").status_code == 204

    payload = pc.payload(server)
    r = _sync(server, payload, _choose(server, payload, "pc"))
    assert r.status_code == 200, r.text
    back = server.get(f"/ew-groups/{g['id']}/modes").json()
    assert [m["name"] for m in back] == ["A renamed offline"]
    assert back[0]["line"] == pc_mode["line"]  # its line came back with it
    assert back[0]["line"]["rf_min_mhz"] == FIXED_LINE["rf_min_mhz"]


def test_keeping_the_pcs_group_the_server_deleted_brings_back_all_of_it(admin_client, pc):
    server = admin_client
    e, g, s = _emitter(server)
    _add_mode(server, g, s, "A")
    _add_mode(server, g, s, "B")
    pc.take_copy(server)
    with pc.client() as laptop:
        _add_mode(laptop, g, s, "C")
    assert server.delete(f"/emitters/{e['id']}/ew-groups/{g['id']}").status_code == 204

    payload = pc.payload(server)
    r = _sync(server, payload, _choose(server, payload, "pc"))
    assert r.status_code == 200, r.text
    assert _modes(server, g) == ["A", "B", "C"]
    assert all(m["line"] for m in server.get(f"/ew-groups/{g['id']}/modes").json())


def test_a_change_on_the_server_between_preview_and_sync_is_caught(admin_client, pc):
    server = admin_client
    e, g, s = _emitter(server)
    pc.take_copy(server)
    with pc.client() as laptop:
        laptop.patch(f"/emitters/{e['id']}", json={"description": "PC"})
    payload = pc.payload(server)
    preview = server.post("/sync/preview", json={"payload": payload}).json()
    assert not any(gr["conflicts"] for gr in preview["groups"])

    server.patch(f"/emitters/{e['id']}", json={"description": "Server, meanwhile"})
    refused = _sync(server, payload)
    assert refused.status_code == 409
    assert refused.json()["detail"]["preview"]["unresolved"] == [f"emitters:{e['id']}"]
    assert server.get(f"/emitters/{e['id']}").json()["description"] == "Server, meanwhile"
    assert _sync(server, payload, {f"emitters:{e['id']}": "pc"}).status_code == 200
    assert server.get(f"/emitters/{e['id']}").json()["description"] == "PC"


def test_changes_to_what_never_syncs_are_refused(admin_client, viewer_client, pc, db_session):
    """A PC (or anyone with an Admin's sign-in) can't send changes to user
    accounts or settings: e.g. make a viewer an Admin."""
    server = admin_client
    pc.take_copy(server)
    viewer = db_session.scalar(select(User).where(User.username == "viewer_t"))
    payload = pc.changes()
    row = {"id": str(viewer.id), "username": "viewer_t", "role": "admin"}
    payload["changes"].append({"table": "users", "key": str(viewer.id), "base": dict(row, role="viewer"), "local": row})
    r = server.post("/sync/apply", json={"payload": payload})
    assert r.status_code == 409 and "isn't something that syncs" in r.json()["detail"]
    db_session.expire_all()
    assert db_session.get(User, viewer.id).role.name == "viewer"

    for bad in (
        {"schema": payload["schema"], "changes": [{"table": "no_such_table", "key": "x", "base": None, "local": {}}]},
        {"schema": payload["schema"], "changes": [{"table": "app_settings", "key": "x", "base": None, "local": {"key": "x"}}]},
    ):
        assert server.post("/sync/apply", json={"payload": bad}).status_code == 409
    for malformed in ({"schema": payload["schema"]}, {"schema": payload["schema"], "changes": [{"table": "emitters"}]}):
        assert server.post("/sync/apply", json={"payload": malformed}).status_code == 422


def test_values_travel_exactly(admin_client, pc):
    server = admin_client
    e, g, s = _emitter(server)
    pc.take_copy(server)
    with pc.client() as laptop:
        r = laptop.post(
            f"/ew-groups/{g['id']}/modes",
            json={"source_id": s["id"], "name": "Stagger ÆØÅ ✓", "pri_type": "stagger", "line": STAGGER_LINE},
        )
        assert r.status_code == 201, r.text
        laptop.patch(f"/emitters/{e['id']}", json={"description": 'Line 1\nLine 2 — "quoted", ½ µs, 雷达'})
        on_pc = laptop.get(f"/ew-groups/{g['id']}/modes").json()[0]
    assert _sync(server, pc.payload(server)).status_code == 200
    on_server = server.get(f"/ew-groups/{g['id']}/modes").json()[0]
    assert on_server["name"] == "Stagger ÆØÅ ✓"
    assert on_server["line"] == on_pc["line"]
    assert on_server["line"]["pri_stagger_values_us"] == STAGGER_LINE["pri_stagger_values_us"]
    assert server.get(f"/emitters/{e['id']}").json()["description"] == 'Line 1\nLine 2 — "quoted", ½ µs, 雷达'


def test_someone_editing_on_the_server_is_noted_and_nothing_is_lost(admin_client, editor_client, pc):
    server = admin_client
    e, g, s = _emitter(server)
    _add_mode(server, g, s, "A")
    # Saved and no longer being edited by the admin, so someone else can start.
    assert server.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"}).status_code == 201
    assert server.delete(f"/emitters/{e['id']}/checkout").status_code == 200
    pc.take_copy(server)
    # Someone else starts editing it on the server.
    assert editor_client.post(f"/emitters/{e['id']}/checkout").status_code == 200
    assert editor_client.patch(f"/emitters/{e['id']}", json={"designation": "ED-1"}).status_code == 200
    with pc.client() as laptop:
        assert laptop.post(f"/emitters/{e['id']}/checkout").status_code == 200
        _add_mode(laptop, g, s, "Logged offline")

    payload = pc.payload(server)
    preview = server.post("/sync/preview", json={"payload": payload}).json()
    assert preview["unresolved"] == []
    assert any("editor_t is editing" in n for n in preview["notes"])
    assert _sync(server, payload).status_code == 200
    assert _modes(server, g) == ["A", "Logged offline"]
    assert server.get(f"/emitters/{e['id']}").json()["designation"] == "ED-1"


def test_a_new_emitter_from_the_pc_is_not_left_locked_on_the_server(admin_client, pc):
    server = admin_client
    pc.take_copy(server)
    with pc.client() as laptop:
        e, g, s = _emitter(laptop, "Made offline")
        _add_mode(laptop, g, s, "A")
        assert laptop.get(f"/emitters/{e['id']}").json()["checked_out_by_id"] is not None
    assert _sync(server, pc.payload(server)).status_code == 200
    on_server = server.get(f"/emitters/{e['id']}").json()
    assert on_server["name"] == "Made offline" and on_server["checked_out_by_id"] is None
    assert _modes(server, g) == ["A"]


def test_renaming_to_a_name_the_server_took_meanwhile(admin_client, pc):
    server = admin_client
    e, g, s = _emitter(server, "Old name")
    pc.take_copy(server)
    with pc.client() as laptop:
        assert laptop.patch(f"/emitters/{e['id']}", json={"name": "Taken"}).status_code == 200
    _emitter(server, "Taken")
    r = _sync(server, pc.payload(server))
    assert r.status_code == 200, r.text
    assert server.get(f"/emitters/{e['id']}").json()["name"] == "Taken (from PC)"


def test_a_pin_both_sides_made_is_one_pin(admin_client, pc):
    server = admin_client
    e, g, s = _emitter(server)
    _add_mode(server, g, s, "A")
    server.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"})
    platform = server.post("/platforms", json={"name": "Frigate"}).json()
    pc.take_copy(server)
    with pc.client() as laptop:
        assert laptop.post(f"/platforms/{platform['id']}/links", json={"emitter_id": e["id"]}).status_code == 201
    assert server.post(f"/platforms/{platform['id']}/links", json={"emitter_id": e["id"]}).status_code == 201

    r = _sync(server, pc.payload(server))
    assert r.status_code == 200, r.text
    assert len(server.get(f"/platforms/{platform['id']}/links").json()) == 1


def test_a_fork_of_a_new_emitter_made_offline(admin_client, pc):
    """Rows pointing at another new row of the same table go in after it."""
    server = admin_client
    pc.take_copy(server)
    with Session(pc.engine) as db:
        # The fork first, so it would go in before its original if nothing sorted them.
        original_id = uuid.uuid4()
        db.add(Emitter(id=uuid.uuid4(), name="Fork", forked_from_emitter_id=original_id))
        db.add(Emitter(id=original_id, name="Original"))
        db.commit()
    r = _sync(server, pc.payload(server))
    assert r.status_code == 200, r.text
    names = {x["name"]: x for x in server.get("/emitters").json()}
    assert {"Fork", "Original"} <= set(names)


def test_nothing_changed_is_nothing_to_sync(admin_client, pc):
    pc.take_copy(admin_client)
    payload = pc.payload(admin_client)
    assert [c for c in payload["changes"] if c["table"] != "audit_log"] == []
    r = _sync(admin_client, payload)
    assert r.status_code == 200
    assert set(r.json()["applied"]) <= {"insert"}  # at most the PC's sign-in entries


def test_a_big_offline_session_syncs_in_reasonable_time(admin_client, pc):
    server = admin_client
    e, g, s = _emitter(server)
    pc.take_copy(server)
    with Session(pc.engine) as db:
        author = db.scalar(select(User.id).where(User.username == "admin_t"))
        db.add_all(
            EmitterNote(id=uuid.uuid4(), emitter_id=uuid.UUID(e["id"]), author_id=author, body=f"Note {i}")
            for i in range(3000)
        )
        db.commit()
    started = time.monotonic()
    payload = pc.payload(server)
    r = _sync(server, payload)
    took = time.monotonic() - started
    assert r.status_code == 200, r.text
    with pc.base.connect() as c:
        assert c.execute(text("SELECT count(*) FROM emitter_notes")).scalar() == 0
    assert len(server.get(f"/emitters/{e['id']}/notes").json()) == 3000
    assert took < 60, f"took {took:.1f}s"
