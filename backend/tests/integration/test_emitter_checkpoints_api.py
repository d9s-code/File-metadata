"""Checkpoints: saves made while editing, between an Emitter's versions."""

from tests.integration.test_modes_api import FIXED_LINE


def _emitter(client, name="Checkpoint Radar"):
    e = client.post("/emitters", json={"name": name}).json()
    g = client.post(f"/emitters/{e['id']}/ew-groups", json={"name": "G"}).json()
    s = client.post(f"/emitters/{e['id']}/sources", json={"name": "S", "source_date": "2025-01-01"}).json()
    return e, g, s


def _add_mode(client, g, s, name):
    r = client.post(f"/ew-groups/{g['id']}/modes", json={"source_id": s["id"], "name": name, "pri_type": "fixed", "line": FIXED_LINE})
    assert r.status_code == 201, r.text


def _modes(client, g):
    return sorted(m["name"] for m in client.get(f"/ew-groups/{g['id']}/modes").json())


def test_checkpoints_between_versions(editor_client):
    client = editor_client
    e, g, s = _emitter(client)
    eid = e["id"]
    # Before any version: v0.1.
    _add_mode(client, g, s, "A")
    first = client.post(f"/emitters/{eid}/checkpoints", json={"change_summary": "A in"})
    assert first.status_code == 201, first.text
    assert (first.json()["kind"], first.json()["ref"]) == ("checkpoint", "0.1")
    assert client.post(f"/emitters/{eid}/versions", json={"change_summary": "v1"}).status_code == 201

    # While editing: checkpoints after v1, and the edit lock stays.
    _add_mode(client, g, s, "B")
    assert client.post(f"/emitters/{eid}/checkpoints", json={}).json()["ref"] == "1.1"
    _add_mode(client, g, s, "C")
    assert client.post(f"/emitters/{eid}/checkpoints", json={"change_summary": "C in"}).json()["ref"] == "1.2"
    assert client.get(f"/emitters/{eid}").json()["checked_out_by_id"] is not None
    # Nothing new since the last save: no checkpoint.
    same = client.post(f"/emitters/{eid}/checkpoints", json={})
    assert same.status_code == 409 and "since v1.2" in same.json()["detail"]

    history = client.get(f"/emitters/{eid}/history").json()
    assert [(h["kind"], h["ref"]) for h in history] == [
        ("checkpoint", "0.1"), ("version", "1"), ("checkpoint", "1.1"), ("checkpoint", "1.2"),
    ]
    # Checkpoints aren't versions: Platforms, exports and tests see only v1.
    assert [v["version_number"] for v in client.get(f"/emitters/{eid}/versions").json()] == [1]

    # Unsaved changes count from the latest save, not the latest version.
    assert client.get(f"/emitters/{eid}/diff/live").json()["identical"] is True
    _add_mode(client, g, s, "D")
    assert client.get(f"/emitters/{eid}/diff/live").json()["identical"] is False
    between = client.get(f"/emitters/{eid}/history/diff", params={"from": "1", "to": "1.2"}).json()
    assert not between["identical"]

    # Discard goes back to v1.2: D goes, B and C stay.
    assert client.post(f"/emitters/{eid}/discard").status_code == 200
    assert _modes(client, g) == ["A", "B", "C"]

    # Going back to a checkpoint, while editing: unsaved until saved.
    client.post(f"/emitters/{eid}/checkout")
    back = client.post(f"/emitters/{eid}/checkpoints/1.1/restore")
    assert back.status_code == 200, back.text
    assert _modes(client, g) == ["A", "B"]
    assert client.get(f"/emitters/{eid}/diff/live").json()["identical"] is False
    assert client.post(f"/emitters/{eid}/checkpoints/1/restore").status_code == 422

    # v1.2 becomes v2; the live Emitter isn't touched.
    made = client.post(f"/emitters/{eid}/checkpoints/1.2/promote", json={"change_summary": "Release with C"})
    assert made.status_code == 201, made.text
    assert (made.json()["ref"], made.json()["from_checkpoint"]) == ("2", "1.2")
    assert _modes(client, g) == ["A", "B"]
    v2 = client.get(f"/emitters/{eid}/versions/2").json()
    assert sorted(m["name"] for gr in v2["snapshot"]["ew_groups"] for m in gr["modes"]) == ["A", "B", "C"]
    history = {h["ref"]: h for h in client.get(f"/emitters/{eid}/history").json()}
    assert history["1.2"]["promoted_to_version_number"] == 2
    # Only a checkpoint since the latest version can become the next one.
    old = client.post(f"/emitters/{eid}/checkpoints/1.1/promote", json={"change_summary": "x"})
    assert old.status_code == 409
    # The next checkpoint follows v2.
    assert client.post(f"/emitters/{eid}/checkpoints", json={}).json()["ref"] == "2.1"
    assert client.get(f"/emitters/{eid}/history/diff", params={"from": "nope"}).status_code == 404


def test_checkpoints_need_the_edit_lock(editor_client, viewer_client):
    e, g, s = _emitter(editor_client, "Locked Checkpoint Radar")
    assert viewer_client.post(f"/emitters/{e['id']}/checkpoints", json={}).status_code == 403
    editor_client.delete(f"/emitters/{e['id']}/checkout")
    r = editor_client.post(f"/emitters/{e['id']}/checkpoints", json={})
    assert r.status_code == 409
    # Anyone can read the history.
    assert viewer_client.get(f"/emitters/{e['id']}/history").status_code == 200
