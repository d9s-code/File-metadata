"""Test runs in progress: saved as they're filled in, picked up again,
logged (which deletes the draft) or discarded — and Default Unknown as an
intercepted-as result."""

from tests.integration.test_test_records_api import emitter_with_mode  # noqa: F401  (fixture)

STATE = {"lineEntries": {"x": {"included": True, "outcome": "pass"}}, "notes": "half done"}


def _draft(client, emitter_id, **extra):
    body = {"title": "Morning run", "test_type": "simulation", "summary": "1 of 2 SIM lines", "state": STATE, **extra}
    return client.post(f"/emitters/{emitter_id}/test-drafts", json=body)


def test_a_run_in_progress_is_saved_listed_and_picked_up_again(editor_client, viewer_client, emitter_with_mode):  # noqa: F811
    emitter_id = emitter_with_mode["emitter"]["id"]
    resp = _draft(editor_client, emitter_id)
    assert resp.status_code == 201, resp.text
    draft = resp.json()
    assert draft["version"] == 1 and draft["state"] == STATE and draft["created_by_username"] == "editor_t"

    saved = editor_client.put(
        f"/test-drafts/{draft['id']}",
        json={"title": "Morning run", "test_type": "simulation", "summary": "2 of 2", "state": {**STATE, "notes": "done"}, "version": 1},
    )
    assert saved.status_code == 200 and saved.json()["version"] == 2

    # Anyone can see it's in progress, and open it as it was last saved.
    [listed] = viewer_client.get(f"/emitters/{emitter_id}/test-drafts").json()
    assert listed["summary"] == "2 of 2" and "state" not in listed
    assert viewer_client.get(f"/test-drafts/{draft['id']}").json()["state"]["notes"] == "done"
    # ...but not change it.
    assert viewer_client.put(f"/test-drafts/{draft['id']}", json={"test_type": "simulation", "state": {}}).status_code == 403
    assert _draft(viewer_client, emitter_id).status_code == 403


def test_a_save_on_top_of_someone_elses_is_refused(editor_client, emitter_with_mode):  # noqa: F811
    draft = _draft(editor_client, emitter_with_mode["emitter"]["id"]).json()
    body = {"test_type": "simulation", "state": STATE, "version": 1}
    assert editor_client.put(f"/test-drafts/{draft['id']}", json=body).status_code == 200
    stale = editor_client.put(f"/test-drafts/{draft['id']}", json=body)
    assert stale.status_code == 409
    assert "reload" in stale.json()["detail"]


def test_logging_the_run_deletes_its_draft_and_keeps_default_unknown(editor_client, emitter_with_mode):  # noqa: F811
    emitter_id = emitter_with_mode["emitter"]["id"]
    mode_id = emitter_with_mode["mode"]["id"]
    lines = editor_client.post(
        f"/emitters/{emitter_id}/test-lines/import",
        json={"lines": [{"label": "Line A"}, {"label": "Line B"}], "created_date": "2026-09-15"},
    ).json()
    draft = _draft(editor_client, emitter_id).json()
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "simulation",
            "title": "Morning run",
            "test_date": "2026-10-07",
            "simulation_created_date": "2026-09-15",
            "draft_id": draft["id"],
            "line_results": [
                {"test_line_id": lines[0]["id"], "outcome": "fail", "intercepted_as_unknown": True},
                {
                    "test_line_id": lines[1]["id"],
                    "outcome": "partial",
                    "intercepted_mode_ids": [mode_id],
                    "intercepted_as_unknown": True,
                },
            ],
        },
    )
    assert resp.status_code == 201, resp.text
    by_label = {line["test_line_label"]: line for line in resp.json()["lines"]}
    assert by_label["Line A"]["intercepted_as_unknown"] is True and by_label["Line A"]["intercepted_modes"] == []
    assert by_label["Line B"]["intercepted_as_unknown"] is True
    assert [m["mode_name"] for m in by_label["Line B"]["intercepted_modes"]] == ["Mode 1"]

    assert editor_client.get(f"/emitters/{emitter_id}/test-drafts").json() == []
    gone = editor_client.put(f"/test-drafts/{draft['id']}", json={"test_type": "simulation", "state": {}})
    assert gone.status_code == 404 and "logged or discarded" in gone.json()["detail"]


def test_a_draft_can_be_discarded(editor_client, emitter_with_mode):  # noqa: F811
    emitter_id = emitter_with_mode["emitter"]["id"]
    draft = _draft(editor_client, emitter_id).json()
    assert editor_client.delete(f"/test-drafts/{draft['id']}").status_code == 204
    assert editor_client.get(f"/emitters/{emitter_id}/test-drafts").json() == []
    assert editor_client.get(f"/test-drafts/{draft['id']}").status_code == 404
