"""An Emitter's trail narrowed to its Modes tells what happened to them:
a revert or a discard logs each Mode it brought back, removed or changed,
a Mode made by adding a value says which Mode it copies, and the version
saves, reverts and discards stay in the narrowed trail as markers."""

from tests.integration.test_ambiguity_api import FIXED_LINE


def _trail(client, eid, **params) -> list[dict]:
    page = client.get("/audit-log", params={"emitter_id": eid, "limit": 200, **params}).json()
    return page["items"]


def _build(client):
    emitter = client.post("/emitters", json={"name": "Trail Radar"}).json()
    eid = emitter["id"]
    group = client.post(f"/emitters/{eid}/ew-groups", json={"name": "Search"}).json()
    source = client.post(f"/emitters/{eid}/sources", json={"name": "Datasheet", "source_date": "2026-01-01"}).json()
    modes = f"/ew-groups/{group['id']}/modes"
    one = client.post(modes, json={"source_id": source["id"], "name": "Mode 1", "pri_type": "fixed", "line": FIXED_LINE}).json()
    two = client.post(modes, json={"source_id": source["id"], "name": "Mode 2", "pri_type": "fixed", "line": FIXED_LINE}).json()
    assert client.post(f"/emitters/{eid}/versions", json={"change_summary": "first"}).status_code == 201
    return eid, modes, source, one, two


def test_a_revert_logs_each_mode_it_brings_back_removes_or_changes(editor_client):
    eid, modes, source, one, two = _build(editor_client)
    wider = {**FIXED_LINE, "rf_min_mhz": FIXED_LINE["rf_min_mhz"] - 20}
    assert editor_client.patch(f"{modes}/{one['id']}", json={"pri_type": "fixed", "line": wider}).status_code == 200
    assert editor_client.delete(f"{modes}/{two['id']}").status_code == 204
    editor_client.post(modes, json={"source_id": source["id"], "name": "Mode 3", "pri_type": "fixed", "line": FIXED_LINE})
    editor_client.post(f"/emitters/{eid}/versions", json={"change_summary": "second"})

    assert editor_client.post(f"/emitters/{eid}/versions/1/revert").status_code == 200
    entries = {e["summary"]: e for e in _trail(editor_client, eid, entity_type="mode")}
    assert "Brought back Mode 'Mode 2' — reverting to version 1" in entries
    assert "Removed Mode 'Mode 3' — reverting to version 1" in entries
    changed = entries["Changed Mode 'Mode 1' back — reverting to version 1"]
    assert changed["action"] == "update"
    assert changed["changes"] == {"rf_min_mhz": {"old": wider["rf_min_mhz"], "new": FIXED_LINE["rf_min_mhz"]}}

    # A discard tells the same way.
    editor_client.patch(f"{modes}/{one['id']}", json={"pri_type": "fixed", "line": wider})
    assert editor_client.post(f"/emitters/{eid}/discard").status_code == 200
    summaries = [e["summary"] for e in _trail(editor_client, eid, entity_type="mode")]
    assert "Changed Mode 'Mode 1' back — discarding unsaved changes (back to version 3)" in summaries


def test_a_narrowed_trail_keeps_the_version_markers(editor_client):
    eid, modes, source, one, two = _build(editor_client)
    editor_client.delete(f"{modes}/{two['id']}")
    editor_client.post(f"/emitters/{eid}/versions", json={"change_summary": "second"})
    editor_client.post(f"/emitters/{eid}/versions/1/revert")

    plain = _trail(editor_client, eid, entity_type="mode")
    assert all(e["entity_type"] == "mode" for e in plain)
    marked = _trail(editor_client, eid, entity_type="mode", with_versions=True)
    markers = [(e["action"], e["changes"]) for e in marked if e["entity_type"] == "emitter"]
    assert markers == [
        ("revert", {"version_number": 3, "reverted_to": 1}),
        ("commit", {"version_number": 2}),
        ("commit", {"version_number": 1}),
    ]
    # The revert's own entry comes before the changes it made (newest first).
    summaries = [e["summary"] for e in marked]
    assert summaries.index("Emitter 'Trail Radar': Reverted to version 1") < summaries.index(
        "Brought back Mode 'Mode 2' — reverting to version 1"
    )


def test_a_mode_made_by_adding_a_value_says_which_mode_it_copies(editor_client):
    eid, modes, source, one, two = _build(editor_client)
    editor_client.delete(f"{modes}/{two['id']}")
    body = {
        "parameter": "pri",
        "pri_type": "fixed",
        "values": {"pri_min_us": 1500, "pri_max_us": 1500, "jitter_min_us": 0, "jitter_max_us": 1, "pri_delta": 0},
    }
    plan = editor_client.post(f"/emitters/{eid}/modes/add-parameter/plan", json=body).json()
    key = next(r["key"] for r in plan["rows"] if one["id"] in r["mode_ids"])
    resp = editor_client.post(f"/emitters/{eid}/modes/add-parameter", json={**body, "row_keys": [key], "name_base": "PRI 1500"})
    assert resp.status_code == 201, resp.text
    summaries = [e["summary"] for e in _trail(editor_client, eid, entity_type="mode")]
    assert any(s.startswith("Created Mode 'PRI 1500 1' — Mode 1 with PRI 1500") and s.endswith(" added") for s in summaries)


def test_a_trail_narrows_to_one_parameter_with_kind_and_action(editor_client):
    eid, modes, source, one, two = _build(editor_client)
    wider = {**FIXED_LINE, "rf_max_mhz": FIXED_LINE["rf_max_mhz"] + 20}
    editor_client.patch(f"{modes}/{one['id']}", json={"pri_type": "fixed", "line": wider})
    editor_client.post(f"/emitters/{eid}/modes/batch-edit", json={"mode_ids": [two["id"]], "fields": {"jitter_max_us": 20}})
    editor_client.patch(f"{modes}/{two['id']}", json={"notes": "checked"})

    def summaries(**params):
        return [e["summary"] for e in _trail(editor_client, eid, entity_type="mode", **params)]

    assert summaries(action="update", parameter="rf") == ["Updated Mode 'Mode 1'"]
    assert summaries(action="update", parameter="jitter") == ["Batch-updated Mode 'Mode 2'"]
    # A creation counts for every parameter its line sets.
    assert set(summaries(action="create", parameter="rf")) == {"Created Mode 'Mode 1'", "Created Mode 'Mode 2'"}
    assert summaries(action="update", parameter="notes") == ["Updated Mode 'Mode 2'"]
    assert editor_client.get("/audit-log", params={"parameter": "nonsense"}).status_code == 422
    assert [p["key"] for p in editor_client.get("/audit-log/parameters").json()][:5] == ["rf", "pri", "pw", "jitter", "stagger"]


def test_an_edit_from_a_test_says_it_is_test_derived(editor_client):
    eid, modes, source, one, two = _build(editor_client)
    version = editor_client.get(f"/emitters/{eid}/versions").json()[-1]["id"]
    run = editor_client.post(
        f"/emitters/{eid}/test-records",
        json={"test_type": "simulation", "title": "Range day 5", "test_date": "2026-10-28", "simulation_created_date": "2026-10-01",
              "received_power_dbfs": -40, "result": "partial", "emitter_version_id": version},
    ).json()  # fmt: skip
    wider = {**FIXED_LINE, "rf_min_mhz": FIXED_LINE["rf_min_mhz"] - 30}
    resp = editor_client.patch(
        f"{modes}/{one['id']}", json={"pri_type": "fixed", "line": wider, "derived_from_test_record_ids": [run["id"]]}
    )
    assert resp.status_code == 200, resp.text
    entries = _trail(editor_client, eid, entity_type="mode", action="update")
    assert entries[0]["summary"] == "Updated Mode 'Mode 1' (test-derived: 'Range day 5')"
    assert entries[0]["changes"]["rf_min_mhz"] == {"old": FIXED_LINE["rf_min_mhz"], "new": FIXED_LINE["rf_min_mhz"] - 30}
