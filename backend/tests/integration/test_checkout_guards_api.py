import uuid

import pytest

from app.core.enums import Role
from app.core.security import hash_password
from app.models.user import User
from tests.conftest import _new_authenticated_client


@pytest.fixture()
def other_editor(db_override, db_session):
    db_session.add(User(username="editor_other", password_hash=hash_password("otherpass12345"), role=Role.editor))
    db_session.commit()
    return _new_authenticated_client(db_override, "editor_other", "otherpass12345")


@pytest.fixture()
def held_emitter(editor_client):
    # Creating an Emitter checks it out to its creator.
    return editor_client.post("/emitters", json={"name": "Held Emitter"}).json()


def test_other_editor_cannot_delete_a_held_emitter(other_editor, held_emitter):
    resp = other_editor.delete(f"/emitters/{held_emitter['id']}")
    assert resp.status_code == 409
    assert "checked out by another user" in resp.json()["detail"]


def test_admin_can_delete_a_held_emitter(admin_client, held_emitter):
    assert admin_client.delete(f"/emitters/{held_emitter['id']}").status_code == 204


def test_holder_can_delete_and_the_checkout_is_released(editor_client, held_emitter):
    eid = held_emitter["id"]
    assert editor_client.delete(f"/emitters/{eid}").status_code == 204
    editor_client.post(f"/emitters/{eid}/restore")
    assert editor_client.get(f"/emitters/{eid}").json()["checked_out_by_id"] is None


def test_anyone_can_delete_an_emitter_nobody_holds(editor_client, other_editor, held_emitter):
    eid = held_emitter["id"]
    editor_client.delete(f"/emitters/{eid}/checkout")
    assert other_editor.delete(f"/emitters/{eid}").status_code == 204


def test_other_editor_cannot_commit_a_version(other_editor, held_emitter):
    resp = other_editor.post(f"/emitters/{held_emitter['id']}/versions", json={"change_summary": "sneaky"})
    assert resp.status_code == 409


def test_holder_can_commit_a_version(editor_client, held_emitter):
    resp = editor_client.post(f"/emitters/{held_emitter['id']}/versions", json={"change_summary": "mine"})
    assert resp.status_code == 201


def test_other_editor_cannot_delete_a_generation_batch(other_editor, held_emitter):
    resp = other_editor.delete(f"/emitters/{held_emitter['id']}/generation-batches/{uuid.uuid4()}")
    assert resp.status_code == 409


def test_other_editor_cannot_json_import(other_editor, held_emitter):
    eid = held_emitter["id"]
    resp = other_editor.post(f"/emitters/{eid}/imports", json={"document_name": "d", "sources": []})
    assert resp.status_code == 409
    resp = other_editor.post(
        f"/emitters/{eid}/imports/json-import", files={"file": ("d.json", b"{}", "application/json")}
    )
    assert resp.status_code == 409
