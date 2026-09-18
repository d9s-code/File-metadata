def _make_emitter(client, name="Notes Emitter"):
    return client.post("/emitters", json={"name": name}).json()


def _make_source(client, emitter_id, name="Notes Source"):
    return client.post(
        f"/emitters/{emitter_id}/sources", json={"name": name, "source_date": "2025-01-01"}
    ).json()


def test_emitter_note_create_is_additive_not_overwritten(editor_client):
    emitter = _make_emitter(editor_client)

    first = editor_client.post(f"/emitters/{emitter['id']}/notes", json={"body": "First observation"})
    assert first.status_code == 201, first.text
    second = editor_client.post(f"/emitters/{emitter['id']}/notes", json={"body": "Second observation"})
    assert second.status_code == 201, second.text

    notes = editor_client.get(f"/emitters/{emitter['id']}/notes").json()
    assert len(notes) == 2
    # Newest first.
    assert notes[0]["body"] == "Second observation"
    assert notes[1]["body"] == "First observation"
    assert notes[0]["author_username"] == "editor_t"
    assert notes[0]["id"] != notes[1]["id"]


def test_emitter_note_requires_editor_role(editor_client, viewer_client):
    emitter = _make_emitter(editor_client)
    resp = viewer_client.post(f"/emitters/{emitter['id']}/notes", json={"body": "Not allowed"})
    assert resp.status_code == 403

    # Viewer can still read the (empty) list.
    resp = viewer_client.get(f"/emitters/{emitter['id']}/notes")
    assert resp.status_code == 200
    assert resp.json() == []


def test_emitter_note_delete(editor_client):
    emitter = _make_emitter(editor_client)
    note = editor_client.post(f"/emitters/{emitter['id']}/notes", json={"body": "Delete me"}).json()

    resp = editor_client.delete(f"/emitters/{emitter['id']}/notes/{note['id']}")
    assert resp.status_code == 204

    notes = editor_client.get(f"/emitters/{emitter['id']}/notes").json()
    assert notes == []


def test_emitter_note_404_for_unknown_emitter_or_note(editor_client):
    emitter = _make_emitter(editor_client)
    other_emitter = _make_emitter(editor_client, name="Other Emitter")
    note = editor_client.post(f"/emitters/{emitter['id']}/notes", json={"body": "Scoped"}).json()

    # A note belonging to a different Emitter is not reachable through this one.
    resp = editor_client.delete(f"/emitters/{other_emitter['id']}/notes/{note['id']}")
    assert resp.status_code == 404


def test_emitter_out_no_longer_has_single_notes_field(editor_client):
    emitter = _make_emitter(editor_client)
    assert "notes" not in emitter


def test_source_note_create_is_additive_not_overwritten(editor_client):
    emitter = _make_emitter(editor_client)
    source = _make_source(editor_client, emitter["id"])

    first = editor_client.post(f"/emitters/{emitter['id']}/sources/{source['id']}/notes", json={"body": "Note 1"})
    assert first.status_code == 201, first.text
    second = editor_client.post(f"/emitters/{emitter['id']}/sources/{source['id']}/notes", json={"body": "Note 2"})
    assert second.status_code == 201, second.text

    notes = editor_client.get(f"/emitters/{emitter['id']}/sources/{source['id']}/notes").json()
    assert len(notes) == 2
    assert notes[0]["body"] == "Note 2"
    assert notes[1]["body"] == "Note 1"


def test_source_note_requires_editor_role(editor_client, viewer_client):
    emitter = _make_emitter(editor_client)
    source = _make_source(editor_client, emitter["id"])
    resp = viewer_client.post(
        f"/emitters/{emitter['id']}/sources/{source['id']}/notes", json={"body": "Nope"}
    )
    assert resp.status_code == 403


def test_source_note_delete(editor_client):
    emitter = _make_emitter(editor_client)
    source = _make_source(editor_client, emitter["id"])
    note = editor_client.post(
        f"/emitters/{emitter['id']}/sources/{source['id']}/notes", json={"body": "Delete me"}
    ).json()

    resp = editor_client.delete(f"/emitters/{emitter['id']}/sources/{source['id']}/notes/{note['id']}")
    assert resp.status_code == 204

    notes = editor_client.get(f"/emitters/{emitter['id']}/sources/{source['id']}/notes").json()
    assert notes == []


def test_source_out_no_longer_has_single_notes_field(editor_client):
    emitter = _make_emitter(editor_client)
    source = _make_source(editor_client, emitter["id"])
    assert "notes" not in source


def test_deleting_emitter_cascades_its_notes(editor_client, admin_client):
    emitter = _make_emitter(editor_client)
    editor_client.post(f"/emitters/{emitter['id']}/notes", json={"body": "Will be cascaded"})

    resp = admin_client.delete(f"/emitters/{emitter['id']}?hard=true")
    assert resp.status_code == 204


def _make_mdf(client, name="Notes MDF"):
    return client.post("/mdfs", json={"name": name}).json()


def test_mdf_note_create_is_additive_not_overwritten(editor_client):
    mdf = _make_mdf(editor_client)

    first = editor_client.post(f"/mdfs/{mdf['id']}/notes", json={"body": "First observation"})
    assert first.status_code == 201, first.text
    second = editor_client.post(f"/mdfs/{mdf['id']}/notes", json={"body": "Second observation"})
    assert second.status_code == 201, second.text

    notes = editor_client.get(f"/mdfs/{mdf['id']}/notes").json()
    assert len(notes) == 2
    assert notes[0]["body"] == "Second observation"
    assert notes[1]["body"] == "First observation"
    assert notes[0]["author_username"] == "editor_t"


def test_mdf_note_requires_editor_role(editor_client, viewer_client):
    mdf = _make_mdf(editor_client)
    resp = viewer_client.post(f"/mdfs/{mdf['id']}/notes", json={"body": "Not allowed"})
    assert resp.status_code == 403

    resp = viewer_client.get(f"/mdfs/{mdf['id']}/notes")
    assert resp.status_code == 200
    assert resp.json() == []


def test_mdf_note_delete(editor_client):
    mdf = _make_mdf(editor_client)
    note = editor_client.post(f"/mdfs/{mdf['id']}/notes", json={"body": "Delete me"}).json()

    resp = editor_client.delete(f"/mdfs/{mdf['id']}/notes/{note['id']}")
    assert resp.status_code == 204

    notes = editor_client.get(f"/mdfs/{mdf['id']}/notes").json()
    assert notes == []


def test_mdf_note_404_for_unknown_mdf_or_note(editor_client):
    mdf = _make_mdf(editor_client)
    other_mdf = _make_mdf(editor_client, name="Other Notes MDF")
    note = editor_client.post(f"/mdfs/{mdf['id']}/notes", json={"body": "Scoped"}).json()

    resp = editor_client.delete(f"/mdfs/{other_mdf['id']}/notes/{note['id']}")
    assert resp.status_code == 404


def test_mdf_note_coexists_with_the_single_notes_field(editor_client):
    mdf = editor_client.post("/mdfs", json={"name": "Both Notes MDF", "notes": "flat summary"}).json()
    assert mdf["notes"] == "flat summary"

    editor_client.post(f"/mdfs/{mdf['id']}/notes", json={"body": "feed entry"})
    notes = editor_client.get(f"/mdfs/{mdf['id']}/notes").json()
    assert len(notes) == 1
    assert notes[0]["body"] == "feed entry"

    # The flat field is untouched by adding a feed entry.
    refetched = editor_client.get(f"/mdfs/{mdf['id']}").json()
    assert refetched["notes"] == "flat summary"
