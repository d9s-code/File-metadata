"""Batch edit can mark the selected Modes test-derived: linked to the
Emitter's own test runs, on their own or with value changes, never twice,
and said in each Mode's audit entry."""

from tests.integration.test_audit_story_api import _build, _trail


def _run(client, eid, title):
    resp = client.post(
        f"/emitters/{eid}/test-records",
        json={"test_type": "simulation", "title": title, "test_date": "2026-10-28", "simulation_created_date": "2026-10-01",
              "received_power_dbfs": -40, "result": "partial"},
    )  # fmt: skip
    assert resp.status_code == 201, resp.text
    return resp.json()


def _derived(client, eid) -> dict[str, list[str]]:
    return {m["name"]: [r["title"] for r in m["derived_from_test_records"]] for m in client.get(f"/emitters/{eid}/modes").json()}


def test_batch_edit_marks_modes_test_derived_on_its_own(editor_client):
    eid, _modes, _source, one, two = _build(editor_client)
    run = _run(editor_client, eid, "Range day 5")
    resp = editor_client.post(
        f"/emitters/{eid}/modes/batch-edit",
        json={"mode_ids": [one["id"], two["id"]], "fields": {}, "derived_from_test_record_ids": [run["id"]]},
    )
    assert resp.status_code == 200, resp.text
    assert _derived(editor_client, eid) == {"Mode 1": ["Range day 5"], "Mode 2": ["Range day 5"]}

    summaries = [e["summary"] for e in _trail(editor_client, eid, entity_type="mode", action="update")]
    assert "Batch-updated Mode 'Mode 1' (test-derived: 'Range day 5')" in summaries

    # The run lists them as derived from it.
    record = next(r for r in editor_client.get(f"/emitters/{eid}/test-records").json() if r["id"] == run["id"])
    assert sorted(m["mode_name"] for m in record["modes"] if m["link_type"] == "derived") == ["Mode 1", "Mode 2"]


def test_a_mode_already_linked_is_not_linked_twice(editor_client):
    eid, _modes, _source, one, two = _build(editor_client)
    first, second = _run(editor_client, eid, "Range day 5"), _run(editor_client, eid, "Range day 6")
    url = f"/emitters/{eid}/modes/batch-edit"
    editor_client.post(url, json={"mode_ids": [one["id"]], "fields": {}, "derived_from_test_record_ids": [first["id"]]})
    resp = editor_client.post(
        url, json={"mode_ids": [one["id"], two["id"]], "fields": {}, "derived_from_test_record_ids": [first["id"], second["id"]]}
    )
    assert resp.status_code == 200, resp.text
    derived = _derived(editor_client, eid)
    assert sorted(derived["Mode 1"]) == ["Range day 5", "Range day 6"]
    assert sorted(derived["Mode 2"]) == ["Range day 5", "Range day 6"]
    # Mode 1's second entry names only the run it was newly linked to.
    summaries = [e["summary"] for e in _trail(editor_client, eid, entity_type="mode", action="update")]
    assert "Batch-updated Mode 'Mode 1' (test-derived: 'Range day 6')" in summaries


def test_with_value_changes_too(editor_client):
    eid, _modes, _source, one, _two = _build(editor_client)
    run = _run(editor_client, eid, "Range day 5")
    resp = editor_client.post(
        f"/emitters/{eid}/modes/batch-edit",
        json={"mode_ids": [one["id"]], "fields": {"confirmation_quality": 80}, "derived_from_test_record_ids": [run["id"]]},
    )
    assert resp.status_code == 200, resp.text
    mode = next(m for m in editor_client.get(f"/emitters/{eid}/modes").json() if m["id"] == one["id"])
    assert mode["confirmation_quality"] == 80
    assert [r["title"] for r in mode["derived_from_test_records"]] == ["Range day 5"]


def test_another_emitters_run_is_refused(editor_client):
    eid, _modes, _source, one, _two = _build(editor_client)
    other = editor_client.post("/emitters", json={"name": "Other Radar"}).json()
    editor_client.post(f"/emitters/{other['id']}/ew-groups", json={"name": "Search"})
    foreign = _run(editor_client, other["id"], "Someone else's run")
    resp = editor_client.post(
        f"/emitters/{eid}/modes/batch-edit",
        json={"mode_ids": [one["id"]], "fields": {}, "derived_from_test_record_ids": [foreign["id"]]},
    )
    assert resp.status_code == 422
    assert "Someone else's run" in resp.json()["detail"]
    assert _derived(editor_client, eid)["Mode 1"] == []


def test_batch_edit_removes_test_derived_links(editor_client):
    eid, _modes, _source, one, two = _build(editor_client)
    first, second = _run(editor_client, eid, "Range day 5"), _run(editor_client, eid, "Range day 6")
    url = f"/emitters/{eid}/modes/batch-edit"
    editor_client.post(url, json={"mode_ids": [one["id"], two["id"]], "fields": {}, "derived_from_test_record_ids": [first["id"], second["id"]]})
    # Mode 2 is no longer derived from the first run; Mode 1 isn't selected and keeps both.
    resp = editor_client.post(url, json={"mode_ids": [two["id"]], "fields": {}, "remove_derived_from_test_record_ids": [first["id"]]})
    assert resp.status_code == 200, resp.text
    derived = _derived(editor_client, eid)
    assert sorted(derived["Mode 1"]) == ["Range day 5", "Range day 6"]
    assert derived["Mode 2"] == ["Range day 6"]
    summaries = [e["summary"] for e in _trail(editor_client, eid, entity_type="mode", action="update")]
    assert "Batch-updated Mode 'Mode 2' (no longer test-derived: 'Range day 5')" in summaries
    record = next(r for r in editor_client.get(f"/emitters/{eid}/test-records").json() if r["id"] == first["id"])
    assert [m["mode_name"] for m in record["modes"] if m["link_type"] == "derived"] == ["Mode 1"]


def test_removing_and_adding_the_same_run_is_refused(editor_client):
    eid, _modes, _source, one, _two = _build(editor_client)
    run = _run(editor_client, eid, "Range day 5")
    resp = editor_client.post(
        f"/emitters/{eid}/modes/batch-edit",
        json={"mode_ids": [one["id"]], "fields": {}, "derived_from_test_record_ids": [run["id"]], "remove_derived_from_test_record_ids": [run["id"]]},
    )
    assert resp.status_code == 422
