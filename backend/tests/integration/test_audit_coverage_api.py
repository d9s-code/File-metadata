"""Changes that weren't in the Audit Log before: reordering milestones,
starting and discarding a test run in progress, running an ambiguity check,
and changing one's own settings."""

from tests.integration.test_ambiguity_api import emitter_with_two_overlapping_modes  # noqa: F401  (fixture)


def _summaries(client, **params) -> list[str]:
    page = client.get("/audit-log", params={"limit": 200, **params}).json()
    return [e["summary"] for e in (page["items"] if isinstance(page, dict) else page)]


def test_reordering_milestones_is_logged(admin_client):
    first = admin_client.post(
        "/milestones/defaults", json={"entity_type": "emitter", "status_key": "in_review", "title": "Bench test"}
    ).json()
    second = admin_client.post(
        "/milestones/defaults", json={"entity_type": "emitter", "status_key": "in_review", "title": "Range test"}
    ).json()
    resp = admin_client.post("/milestones/reorder", json={"ids": [second["id"], first["id"]]})
    assert resp.status_code == 200, resp.text
    assert "Reordered default Emitter milestones: Range test, Bench test" in _summaries(admin_client)
    # The same order again changes nothing, and isn't logged again.
    admin_client.post("/milestones/reorder", json={"ids": [second["id"], first["id"]]})
    assert sum(s.startswith("Reordered default Emitter milestones") for s in _summaries(admin_client)) == 1


def test_a_test_run_in_progress_is_logged_when_started_and_discarded(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Draft Emitter"}).json()
    draft = editor_client.post(
        f"/emitters/{emitter['id']}/test-drafts", json={"title": "Range day", "test_type": "simulation", "state": {}}
    ).json()
    # Saving as it's filled in isn't logged — that would bury the log.
    editor_client.put(f"/test-drafts/{draft['id']}", json={"title": "Range day", "test_type": "simulation", "state": {"a": 1}, "version": 1})
    assert editor_client.delete(f"/test-drafts/{draft['id']}").status_code == 204
    summaries = _summaries(editor_client, emitter_id=emitter["id"])
    assert "Started the test run in progress 'Range day' on Draft Emitter" in summaries
    assert "Discarded the test run in progress 'Range day' on Draft Emitter" in summaries
    assert sum("test run in progress" in s for s in summaries) == 2


def test_running_an_ambiguity_check_is_logged(editor_client, emitter_with_two_overlapping_modes):  # noqa: F811
    emitter = emitter_with_two_overlapping_modes["emitter"]
    resp = editor_client.post("/ambiguity/runs", json={"scope_type": "emitter", "scope_id": emitter["id"]})
    assert resp.status_code == 201, resp.text
    assert any(
        s.startswith("Ran the ambiguity check of Emitter 'Ambiguity Emitter' (version 1; thresholds 30 / 70 / 99 %)")
        for s in _summaries(editor_client, emitter_id=emitter["id"])
    )


def test_changing_ones_own_settings_is_logged(viewer_client, admin_client):
    assert viewer_client.patch("/auth/me/preferences", json={"ai_chat": False}).status_code == 200
    assert "viewer_t changed their settings: ai chat off" in _summaries(admin_client)
    # Nothing changed, nothing logged.
    viewer_client.patch("/auth/me/preferences", json={"ai_chat": False})
    assert sum("viewer_t changed their settings" in s for s in _summaries(admin_client)) == 1


def test_settings_changes_read_as_words(admin_client):
    admin_client.patch("/settings", json={"dwell_bandwidth_mhz": 20})
    admin_client.patch("/settings", json={"ai_chat_max_context_tokens": 65536})
    admin_client.patch("/settings", json={"outline_page_kinds": {"Trials": "test_result"}})
    summaries = _summaries(admin_client)
    assert "Changed the dwell charts' default bandwidth: 10 → 20 MHz" in summaries
    assert "Changed the AI chat's max context: 32,768 → 65,536 tokens" in summaries
    assert "Changed what lives where in the AI documentation (1 page set)" in summaries


def test_an_emitters_trail_counts_and_filters_by_kind(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Kinds Emitter"}).json()
    editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "G"})
    counts = {
        k["entity_type"]: k["count"]
        for k in editor_client.get("/audit-log/entity-types", params={"emitter_id": emitter["id"]}).json()
        if k["count"]
    }
    assert counts == {"emitter": 1, "ew_group": 1}
    only_groups = _summaries(editor_client, emitter_id=emitter["id"], entity_type="ew_group")
    assert only_groups == ["Created EW Group 'G'"]
