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
def emitter_with_mode(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Test Record Emitter"}).json()
    ew_group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Group A"}).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Source A", "source_date": "2025-01-01"}
    ).json()
    mode = editor_client.post(
        f"/ew-groups/{ew_group['id']}/modes",
        json={"source_id": source["id"], "name": "Mode 1", "pri_type": "fixed", "line": FIXED_LINE},
    ).json()
    return {"emitter": emitter, "mode": mode}


def test_create_test_record_links_modes(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    mode_id = emitter_with_mode["mode"]["id"]
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "lab_bench",
            "title": "Bench run",
            "test_date": "2026-01-01",
            "mode_results": [{"mode_id": mode_id, "result": "pass"}],
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert len(body["modes"]) == 1
    assert body["modes"][0]["mode_id"] == mode_id
    assert body["modes"][0]["mode_name"] == "Mode 1"


def test_list_test_records_includes_linked_mode_names(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    mode_id = emitter_with_mode["mode"]["id"]
    editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "lab_bench",
            "title": "Sim run",
            "test_date": "2026-01-02",
            "mode_results": [{"mode_id": mode_id, "result": "pass"}],
        },
    )
    resp = editor_client.get(f"/emitters/{emitter_id}/test-records")
    assert resp.status_code == 200, resp.text
    [record] = resp.json()
    [linked_mode] = record["modes"]
    assert linked_mode["mode_id"] == mode_id
    assert linked_mode["mode_name"] == "Mode 1"
    assert linked_mode["result"] == "pass"


def test_create_test_record_rejects_unknown_mode_id(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "lab_bench",
            "title": "Sim run",
            "test_date": "2026-01-02",
            "mode_results": [{"mode_id": "00000000-0000-0000-0000-000000000000", "result": "pass"}],
        },
    )
    assert resp.status_code == 404


def test_deleting_a_test_linked_mode_does_not_block_deletion(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    mode = emitter_with_mode["mode"]
    editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "lab_bench",
            "title": "Bench run",
            "test_date": "2026-01-01",
            "mode_results": [{"mode_id": mode["id"], "result": "pass"}],
        },
    )
    resp = editor_client.delete(f"/ew-groups/{mode['ew_group_id']}/modes/{mode['id']}")
    assert resp.status_code == 204, resp.text

    # The test record survives, just with that Mode dropped from its list.
    [record] = editor_client.get(f"/emitters/{emitter_id}/test-records").json()
    assert record["modes"] == []


def test_create_test_record_without_modes_still_works(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={"test_type": "field_exercise", "result": "fail", "title": "Field run", "test_date": "2026-01-03"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["modes"] == []


def test_simulation_test_requires_simulation_created_date(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={"test_type": "simulation", "result": "pass", "title": "Sim run", "test_date": "2026-01-02"},
    )
    assert resp.status_code == 422


def test_simulation_test_succeeds_with_simulation_created_date(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "simulation",
            "result": "pass",
            "title": "Sim run",
            "test_date": "2026-01-02",
            "simulation_created_date": "2025-12-01",
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["simulation_created_date"] == "2025-12-01"


def test_non_simulation_test_does_not_require_simulation_created_date(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={"test_type": "lab_bench", "result": "pass", "title": "Bench run", "test_date": "2026-01-02"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["simulation_created_date"] is None


def test_emitter_modes_list_carries_last_test_status(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    mode_id = emitter_with_mode["mode"]["id"]

    [mode_before] = editor_client.get(f"/emitters/{emitter_id}/modes").json()
    assert mode_before["last_tested_at"] is None
    assert mode_before["last_test_result"] is None

    editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "lab_bench",
            "title": "Bench run",
            "test_date": "2026-01-05",
            "mode_results": [{"mode_id": mode_id, "result": "partial"}],
        },
    )
    [mode_after] = editor_client.get(f"/emitters/{emitter_id}/modes").json()
    assert mode_after["last_tested_at"] == "2026-01-05"
    assert mode_after["last_test_result"] == "partial"

    # A later test replaces the "last" status.
    editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "lab_bench",
            "title": "Second bench run",
            "test_date": "2026-01-10",
            "mode_results": [{"mode_id": mode_id, "result": "fail"}],
        },
    )
    [mode_latest] = editor_client.get(f"/emitters/{emitter_id}/modes").json()
    assert mode_latest["last_tested_at"] == "2026-01-10"
    assert mode_latest["last_test_result"] == "fail"
