import pytest

FIXED_LINE = {
    "rf_min_mhz": 2900,
    "rf_max_mhz": 3100,
    "pw_min_us": 0.5,
    "pw_max_us": 1.2,
    "pri_min_us": 800,
    "pri_max_us": 1200,
    "jitter_min_us": 5,
    "jitter_max_us": 15,
    "rf_delta": 1,
    "pw_delta": 0.05,
    "pri_delta": 10,
    "rf_range_matching": False,
    "pw_range_matching": False,
    "pri_range_matching": False,
}


@pytest.fixture()
def emitter_with_modes(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Function Group Emitter"}).json()
    ew_group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Group A"}).json()
    other_emitter = editor_client.post("/emitters", json={"name": "Other Function Group Emitter"}).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Source A", "source_date": "2025-01-01"}
    ).json()
    mode1 = editor_client.post(
        f"/ew-groups/{ew_group['id']}/modes",
        json={"source_id": source["id"], "name": "Mode 1", "pri_type": "fixed", "line": FIXED_LINE},
    ).json()
    mode2 = editor_client.post(
        f"/ew-groups/{ew_group['id']}/modes",
        json={"source_id": source["id"], "name": "Mode 2", "pri_type": "fixed", "line": FIXED_LINE},
    ).json()
    return {"emitter": emitter, "other_emitter": other_emitter, "ew_group": ew_group, "mode1": mode1, "mode2": mode2}


def test_create_list_update_delete_function_group(editor_client, emitter_with_modes):
    emitter_id = emitter_with_modes["emitter"]["id"]
    resp = editor_client.post(f"/emitters/{emitter_id}/function-groups", json={"name": "Search"})
    assert resp.status_code == 201, resp.text
    group = resp.json()
    assert group["name"] == "Search"
    assert group["modes_count"] == 0

    resp = editor_client.get(f"/emitters/{emitter_id}/function-groups")
    assert resp.status_code == 200, resp.text
    [listed] = resp.json()
    assert listed["id"] == group["id"]

    resp = editor_client.patch(f"/emitters/{emitter_id}/function-groups/{group['id']}", json={"name": "Track"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Track"

    resp = editor_client.delete(f"/emitters/{emitter_id}/function-groups/{group['id']}")
    assert resp.status_code == 204, resp.text
    assert editor_client.get(f"/emitters/{emitter_id}/function-groups").json() == []


def test_function_group_from_another_emitter_is_404(editor_client, emitter_with_modes):
    other_emitter_id = emitter_with_modes["other_emitter"]["id"]
    group = editor_client.post(
        f"/emitters/{emitter_with_modes['emitter']['id']}/function-groups", json={"name": "Search"}
    ).json()
    resp = editor_client.patch(f"/emitters/{other_emitter_id}/function-groups/{group['id']}", json={"name": "x"})
    assert resp.status_code == 404


def test_create_mode_with_function_group(editor_client, emitter_with_modes):
    emitter_id = emitter_with_modes["emitter"]["id"]
    ew_group_id = emitter_with_modes["ew_group"]["id"]
    source_id = editor_client.get(f"/emitters/{emitter_id}/modes").json()[0]["source_id"]
    group = editor_client.post(f"/emitters/{emitter_id}/function-groups", json={"name": "Search"}).json()

    resp = editor_client.post(
        f"/ew-groups/{ew_group_id}/modes",
        json={
            "source_id": source_id,
            "name": "Mode 3",
            "pri_type": "fixed",
            "line": FIXED_LINE,
            "function_group_id": group["id"],
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["function_group_id"] == group["id"]

    [listed] = [g for g in editor_client.get(f"/emitters/{emitter_id}/function-groups").json() if g["id"] == group["id"]]
    assert listed["modes_count"] == 1


def test_create_mode_with_function_group_from_another_emitter_rejected(editor_client, emitter_with_modes):
    emitter_id = emitter_with_modes["emitter"]["id"]
    other_emitter_id = emitter_with_modes["other_emitter"]["id"]
    ew_group_id = emitter_with_modes["ew_group"]["id"]
    source_id = editor_client.get(f"/emitters/{emitter_id}/modes").json()[0]["source_id"]
    other_group = editor_client.post(f"/emitters/{other_emitter_id}/function-groups", json={"name": "Search"}).json()

    resp = editor_client.post(
        f"/ew-groups/{ew_group_id}/modes",
        json={
            "source_id": source_id,
            "name": "Mode X",
            "pri_type": "fixed",
            "line": FIXED_LINE,
            "function_group_id": other_group["id"],
        },
    )
    assert resp.status_code == 404


def test_update_mode_assigns_and_clears_function_group(editor_client, emitter_with_modes):
    emitter_id = emitter_with_modes["emitter"]["id"]
    ew_group_id = emitter_with_modes["ew_group"]["id"]
    mode_id = emitter_with_modes["mode1"]["id"]
    group = editor_client.post(f"/emitters/{emitter_id}/function-groups", json={"name": "Search"}).json()

    resp = editor_client.patch(
        f"/ew-groups/{ew_group_id}/modes/{mode_id}", json={"function_group_id": group["id"]}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["function_group_id"] == group["id"]

    resp = editor_client.patch(f"/ew-groups/{ew_group_id}/modes/{mode_id}", json={"function_group_id": None})
    assert resp.status_code == 200, resp.text
    assert resp.json()["function_group_id"] is None


def test_batch_edit_assigns_function_group(editor_client, emitter_with_modes):
    emitter_id = emitter_with_modes["emitter"]["id"]
    mode1_id = emitter_with_modes["mode1"]["id"]
    mode2_id = emitter_with_modes["mode2"]["id"]
    group = editor_client.post(f"/emitters/{emitter_id}/function-groups", json={"name": "Search"}).json()

    resp = editor_client.post(
        f"/emitters/{emitter_id}/modes/batch-edit",
        json={"mode_ids": [mode1_id, mode2_id], "fields": {"function_group_id": group["id"]}},
    )
    assert resp.status_code == 200, resp.text

    modes = {m["id"]: m for m in editor_client.get(f"/emitters/{emitter_id}/modes").json()}
    assert modes[mode1_id]["function_group_id"] == group["id"]
    assert modes[mode2_id]["function_group_id"] == group["id"]


def test_batch_edit_function_group_from_another_emitter_rejected(editor_client, emitter_with_modes):
    emitter_id = emitter_with_modes["emitter"]["id"]
    other_emitter_id = emitter_with_modes["other_emitter"]["id"]
    mode1_id = emitter_with_modes["mode1"]["id"]
    other_group = editor_client.post(f"/emitters/{other_emitter_id}/function-groups", json={"name": "Search"}).json()

    resp = editor_client.post(
        f"/emitters/{emitter_id}/modes/batch-edit",
        json={"mode_ids": [mode1_id], "fields": {"function_group_id": other_group["id"]}},
    )
    assert resp.status_code == 404


def test_test_record_computes_function_group_rating_with_override(editor_client, emitter_with_modes):
    emitter_id = emitter_with_modes["emitter"]["id"]
    mode1_id = emitter_with_modes["mode1"]["id"]
    mode2_id = emitter_with_modes["mode2"]["id"]
    group = editor_client.post(f"/emitters/{emitter_id}/function-groups", json={"name": "Search"}).json()
    editor_client.post(
        f"/emitters/{emitter_id}/modes/batch-edit",
        json={"mode_ids": [mode1_id, mode2_id], "fields": {"function_group_id": group["id"]}},
    )

    # Worst-of-N: one pass, one partial -> computed 'partial'.
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "intercept",
            "title": "FG run",
            "test_date": "2026-01-01",
            "mode_results": [
                {"mode_id": mode1_id, "result": "pass"},
                {"mode_id": mode2_id, "result": "partial"},
            ],
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    [fg] = body["function_groups"]
    assert fg["function_group_id"] == group["id"]
    assert fg["function_group_name"] == "Search"
    assert fg["computed_result"] == "partial"
    assert fg["override_result"] is None

    # A second test overrides the computed aggregate with the tester's judgment.
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "intercept",
            "title": "FG run 2",
            "test_date": "2026-01-02",
            "mode_results": [
                {"mode_id": mode1_id, "result": "fail"},
                {"mode_id": mode2_id, "result": "fail"},
            ],
            "function_group_overrides": {group["id"]: "partial"},
        },
    )
    assert resp.status_code == 201, resp.text
    [fg2] = resp.json()["function_groups"]
    assert fg2["computed_result"] == "fail"
    assert fg2["override_result"] == "partial"


def test_test_record_without_grouped_modes_has_no_function_groups(editor_client, emitter_with_modes):
    emitter_id = emitter_with_modes["emitter"]["id"]
    mode1_id = emitter_with_modes["mode1"]["id"]
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "intercept",
            "title": "Ungrouped run",
            "test_date": "2026-01-01",
            "mode_results": [{"mode_id": mode1_id, "result": "pass"}],
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["function_groups"] == []
