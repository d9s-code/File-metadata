import pytest


@pytest.fixture()
def emitter_with_version(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Pinned Emitter"}).json()
    v1 = editor_client.post(f"/emitters/{emitter['id']}/versions", json={}).json()
    return {"emitter": emitter, "version": v1}


def test_create_platform(editor_client):
    resp = editor_client.post("/platforms", json={"name": "Platform A", "description": "A ship"})
    assert resp.status_code == 201, resp.text
    assert resp.json()["name"] == "Platform A"


def test_duplicate_platform_name_rejected(editor_client):
    editor_client.post("/platforms", json={"name": "Dup Platform"})
    resp = editor_client.post("/platforms", json={"name": "Dup Platform"})
    assert resp.status_code == 409


def test_pin_requires_a_committed_emitter_version(editor_client):
    platform = editor_client.post("/platforms", json={"name": "No Commit Platform"}).json()
    emitter = editor_client.post("/emitters", json={"name": "Uncommitted Emitter"}).json()
    # Never committed a version, so no emitter_versions row exists to reference.
    import uuid

    fake_version_id = str(uuid.uuid4())
    resp = editor_client.post(
        f"/platforms/{platform['id']}/links",
        json={"emitter_id": emitter["id"], "emitter_version_id": fake_version_id},
    )
    assert resp.status_code == 422


def test_pin_and_repin_emitter_version(editor_client, emitter_with_version):
    platform = editor_client.post("/platforms", json={"name": "Pin Platform"}).json()
    emitter = emitter_with_version["emitter"]
    v1 = emitter_with_version["version"]

    resp = editor_client.post(
        f"/platforms/{platform['id']}/links",
        json={"emitter_id": emitter["id"], "emitter_version_id": v1["id"]},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["emitter_version_id"] == v1["id"]

    # Commit a second emitter version, then repin to it.
    v2 = editor_client.post(f"/emitters/{emitter['id']}/versions", json={}).json()
    resp = editor_client.post(
        f"/platforms/{platform['id']}/links",
        json={"emitter_id": emitter["id"], "emitter_version_id": v2["id"]},
    )
    assert resp.status_code == 201
    assert resp.json()["emitter_version_id"] == v2["id"]

    links = editor_client.get(f"/platforms/{platform['id']}/links").json()
    assert len(links) == 1  # repin updates the existing link, doesn't duplicate
    assert links[0]["emitter_version_id"] == v2["id"]


def test_platform_pinning_survives_new_emitter_version(editor_client, emitter_with_version):
    """Pin to emitter v1, then commit emitter v2 — the platform link stays on
    v1 until an explicit repin action.
    """
    platform = editor_client.post("/platforms", json={"name": "Stable Pin Platform"}).json()
    emitter = emitter_with_version["emitter"]
    v1 = emitter_with_version["version"]
    editor_client.post(
        f"/platforms/{platform['id']}/links", json={"emitter_id": emitter["id"], "emitter_version_id": v1["id"]}
    )

    editor_client.patch(f"/emitters/{emitter['id']}", json={"description": "changed after pin"})
    editor_client.post(f"/emitters/{emitter['id']}/versions", json={})  # v2, unrelated to the pin

    links = editor_client.get(f"/platforms/{platform['id']}/links").json()
    assert links[0]["emitter_version_id"] == v1["id"]


def test_platform_version_commit_and_diff(editor_client, emitter_with_version):
    platform = editor_client.post("/platforms", json={"name": "Versioned Platform"}).json()
    emitter = emitter_with_version["emitter"]
    v1 = emitter_with_version["version"]

    editor_client.post(f"/platforms/{platform['id']}/versions", json={})  # platform v1, no links yet

    editor_client.post(
        f"/platforms/{platform['id']}/links", json={"emitter_id": emitter["id"], "emitter_version_id": v1["id"]}
    )
    editor_client.post(f"/platforms/{platform['id']}/versions", json={})  # platform v2, one link

    diff = editor_client.get(f"/platforms/{platform['id']}/versions/2/diff").json()
    assert len(diff["added"]) == 1
    assert diff["added"][0]["value"]["emitter_id"] == emitter["id"]


def test_unpin_removes_link(editor_client, emitter_with_version):
    platform = editor_client.post("/platforms", json={"name": "Unpin Platform"}).json()
    emitter = emitter_with_version["emitter"]
    v1 = emitter_with_version["version"]
    editor_client.post(
        f"/platforms/{platform['id']}/links", json={"emitter_id": emitter["id"], "emitter_version_id": v1["id"]}
    )
    resp = editor_client.delete(f"/platforms/{platform['id']}/links/{emitter['id']}")
    assert resp.status_code == 204
    assert editor_client.get(f"/platforms/{platform['id']}/links").json() == []
