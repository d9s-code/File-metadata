import pytest


def _soft_delete_emitter(client, name):
    e = client.post("/emitters", json={"name": name}).json()
    assert client.delete(f"/emitters/{e['id']}").status_code == 204
    return e


def test_deleted_emitter_name_can_be_reused(editor_client):
    _soft_delete_emitter(editor_client, "Reusable")
    assert editor_client.post("/emitters", json={"name": "Reusable"}).status_code == 201


def test_restoring_into_a_taken_name_is_409(editor_client):
    old = _soft_delete_emitter(editor_client, "Taken")
    editor_client.post("/emitters", json={"name": "Taken"})
    resp = editor_client.post(f"/emitters/{old['id']}/restore")
    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


def test_deleted_emitter_cannot_be_checked_out_or_edited(editor_client):
    e = _soft_delete_emitter(editor_client, "Gone")
    assert editor_client.post(f"/emitters/{e['id']}/checkout").status_code == 409
    assert editor_client.patch(f"/emitters/{e['id']}", json={"description": "x"}).status_code == 404


def test_restored_emitter_can_be_checked_out_again(editor_client):
    e = _soft_delete_emitter(editor_client, "Back Again")
    editor_client.post(f"/emitters/{e['id']}/restore")
    assert editor_client.post(f"/emitters/{e['id']}/checkout").status_code == 200


def test_renaming_emitter_to_a_taken_name_is_409(editor_client):
    editor_client.post("/emitters", json={"name": "First"})
    second = editor_client.post("/emitters", json={"name": "Second"}).json()
    resp = editor_client.patch(f"/emitters/{second['id']}", json={"name": "First"})
    assert resp.status_code == 409
    assert editor_client.get(f"/emitters/{second['id']}").json()["name"] == "Second"


@pytest.mark.parametrize(("path", "label"), [("/platforms", "Platform"), ("/mdfs", "MDF")])
def test_platform_and_mdf_names_are_unique_among_live_rows_only(editor_client, path, label):
    first = editor_client.post(path, json={"name": "Shared"}).json()
    assert editor_client.delete(f"{path}/{first['id']}").status_code == 204
    second = editor_client.post(path, json={"name": "Shared"})
    assert second.status_code == 201, second.text

    other = editor_client.post(path, json={"name": "Other"}).json()
    resp = editor_client.patch(f"{path}/{other['id']}", json={"name": "Shared"})
    assert resp.status_code == 409
    assert resp.json()["detail"] == f"{label} name already exists"
