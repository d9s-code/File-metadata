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
            "result": "pass",
            "title": "Bench run",
            "test_date": "2026-01-01",
            "mode_ids": [mode_id],
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
            "test_type": "simulation",
            "result": "pass",
            "title": "Sim run",
            "test_date": "2026-01-02",
            "mode_ids": [mode_id],
        },
    )
    resp = editor_client.get(f"/emitters/{emitter_id}/test-records")
    assert resp.status_code == 200, resp.text
    [record] = resp.json()
    assert record["modes"] == [{"mode_id": mode_id, "mode_name": "Mode 1"}]


def test_create_test_record_rejects_unknown_mode_id(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "simulation",
            "result": "pass",
            "title": "Sim run",
            "test_date": "2026-01-02",
            "mode_ids": ["00000000-0000-0000-0000-000000000000"],
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
            "result": "pass",
            "title": "Bench run",
            "test_date": "2026-01-01",
            "mode_ids": [mode["id"]],
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
