"""Turning an Intercept into a Source, so Modes can have it as their Source."""

from tests.integration.test_intercepts_api import MODE_LINE, _create_intercept, emitter_ctx  # noqa: F401  (fixture)


def test_turn_into_source_makes_a_linked_pending_source(editor_client, emitter_ctx):  # noqa: F811
    emitter_id = emitter_ctx["emitter"]["id"]
    intercept = editor_client.post(
        "/intercepts",
        json={"emitter_id": emitter_id, "name": "Morning Pass", "description": "Over the strait", "intercepted_on": "2026-09-14"},
    ).json()
    assert intercept["source_id"] is None

    resp = editor_client.post(f"/intercepts/{intercept['id']}/source")
    assert resp.status_code == 201, resp.text
    linked = resp.json()
    assert linked["source_name"] == "Morning Pass"
    assert linked["source_status"] == "pending_review"

    sources = {s["id"]: s for s in editor_client.get(f"/emitters/{emitter_id}/sources").json()}
    source = sources[linked["source_id"]]
    assert source["intercept_id"] == intercept["id"]
    assert source["intercept_name"] == "Morning Pass"
    assert source["source_type"] == "Intercept"
    assert source["source_date"] == "2026-09-14"
    assert source["description"] == "Over the strait"
    assert source["status"] == "pending_review"

    # A Mode can now have the Intercept as its Source.
    mode = editor_client.post(
        f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes",
        json={"source_id": source["id"], "name": "From the pass", "pri_type": "fixed", "line": MODE_LINE},
    )
    assert mode.status_code == 201, mode.text

    # Only once per Intercept.
    again = editor_client.post(f"/intercepts/{intercept['id']}/source")
    assert again.status_code == 409
    assert editor_client.get(f"/intercepts/{intercept['id']}").json()["source_id"] == source["id"]


def test_turn_into_source_needs_an_editor_holding_the_emitter(editor_client, viewer_client, emitter_ctx):  # noqa: F811
    emitter_id = emitter_ctx["emitter"]["id"]
    intercept = _create_intercept(editor_client, emitter_id)
    assert viewer_client.post(f"/intercepts/{intercept['id']}/source").status_code == 403
    editor_client.delete(f"/emitters/{emitter_id}/checkout")
    resp = editor_client.post(f"/intercepts/{intercept['id']}/source")
    assert resp.status_code == 409
    assert "Start editing" in resp.json()["detail"]


def test_the_link_survives_save_and_discard_and_clears_with_the_intercept(editor_client, emitter_ctx):  # noqa: F811
    emitter_id = emitter_ctx["emitter"]["id"]
    intercept = _create_intercept(editor_client, emitter_id, name="Evening Pass")
    source_id = editor_client.post(f"/intercepts/{intercept['id']}/source").json()["source_id"]

    # Saved with the Emitter, it's in the version.
    version = editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "intercept source"}).json()
    detail = editor_client.get(f"/emitters/{emitter_id}/versions/{version['version_number']}").json()
    snap_source = next(s for s in detail["snapshot"]["sources"] if s["id"] == source_id)
    assert snap_source["intercept_id"] == intercept["id"]
    assert snap_source["source_type"] == "Intercept"

    # Deleted in the draft, then discarded: it comes back still linked.
    editor_client.post(f"/emitters/{emitter_id}/checkout")
    assert editor_client.delete(f"/emitters/{emitter_id}/sources/{source_id}").status_code == 204
    editor_client.post(f"/emitters/{emitter_id}/discard")
    assert editor_client.get(f"/intercepts/{intercept['id']}").json()["source_id"] == source_id

    # Deleting the Intercept keeps the Source (and its Modes), unlinked.
    editor_client.post(f"/emitters/{emitter_id}/checkout")
    assert editor_client.delete(f"/intercepts/{intercept['id']}").status_code == 204
    source = next(s for s in editor_client.get(f"/emitters/{emitter_id}/sources").json() if s["id"] == source_id)
    assert source["intercept_id"] is None
