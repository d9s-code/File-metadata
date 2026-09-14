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
def emitter_with_two_overlapping_modes(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Ambiguity Emitter"}).json()
    ew_group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Group A"}).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Source A", "source_date": "2025-01-01"}
    ).json()

    editor_client.post(
        f"/ew-groups/{ew_group['id']}/modes",
        json={"source_id": source["id"], "name": "Mode 1", "pri_type": "fixed", "line": FIXED_LINE},
    )
    editor_client.post(
        f"/ew-groups/{ew_group['id']}/modes",
        json={"source_id": source["id"], "name": "Mode 2", "pri_type": "fixed", "line": FIXED_LINE},
    )
    version = editor_client.post(f"/emitters/{emitter['id']}/versions", json={}).json()
    return {"emitter": emitter, "version": version}


def test_run_requires_a_committed_version(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "No Commit Ambiguity Emitter"}).json()
    resp = editor_client.post("/ambiguity/runs", json={"scope_type": "emitter", "scope_id": emitter["id"]})
    assert resp.status_code == 422


def test_run_finds_exact_overlap_between_identical_modes(editor_client, emitter_with_two_overlapping_modes):
    emitter_id = emitter_with_two_overlapping_modes["emitter"]["id"]
    resp = editor_client.post("/ambiguity/runs", json={"scope_type": "emitter", "scope_id": emitter_id})
    assert resp.status_code == 201, resp.text
    run = resp.json()
    assert run["status"] in ("pending", "complete")  # background task may already have run synchronously in tests

    # Poll (in tests, TestClient runs background tasks synchronously, so this should already be complete)
    run = editor_client.get(f"/ambiguity/runs/{run['id']}").json()
    assert run["status"] == "complete"

    findings = editor_client.get(f"/ambiguity/runs/{run['id']}/findings").json()
    assert len(findings) == 1
    assert findings[0]["combined_severity"] == "exact_overlap"
    assert findings[0]["details"]["mode_a"]["mode_name"] in ("Mode 1", "Mode 2")


def test_run_uses_specific_version_number_when_given(editor_client, emitter_with_two_overlapping_modes):
    emitter_id = emitter_with_two_overlapping_modes["emitter"]["id"]
    resp = editor_client.post(
        "/ambiguity/runs", json={"scope_type": "emitter", "scope_id": emitter_id, "version_number": 1}
    )
    assert resp.status_code == 201
    run = editor_client.get(f"/ambiguity/runs/{resp.json()['id']}").json()
    assert run["emitter_version_id"] == emitter_with_two_overlapping_modes["version"]["id"]


def test_viewer_can_trigger_run(viewer_client, emitter_with_two_overlapping_modes):
    emitter_id = emitter_with_two_overlapping_modes["emitter"]["id"]
    resp = viewer_client.post("/ambiguity/runs", json={"scope_type": "emitter", "scope_id": emitter_id})
    assert resp.status_code == 201


def test_viewer_cannot_set_custom_tolerance(viewer_client, emitter_with_two_overlapping_modes):
    emitter_id = emitter_with_two_overlapping_modes["emitter"]["id"]
    resp = viewer_client.post(
        "/ambiguity/runs",
        json={
            "scope_type": "emitter",
            "scope_id": emitter_id,
            "tolerance_config": {"low_threshold": 10.0, "high_threshold": 50.0, "exact_threshold": 95.0},
        },
    )
    assert resp.status_code == 403


def test_editor_can_set_custom_tolerance(editor_client, emitter_with_two_overlapping_modes):
    emitter_id = emitter_with_two_overlapping_modes["emitter"]["id"]
    resp = editor_client.post(
        "/ambiguity/runs",
        json={
            "scope_type": "emitter",
            "scope_id": emitter_id,
            "tolerance_config": {"low_threshold": 10.0, "high_threshold": 50.0, "exact_threshold": 95.0},
        },
    )
    assert resp.status_code == 201, resp.text


def test_viewer_cannot_review_finding(viewer_client, editor_client, emitter_with_two_overlapping_modes):
    emitter_id = emitter_with_two_overlapping_modes["emitter"]["id"]
    run = editor_client.post("/ambiguity/runs", json={"scope_type": "emitter", "scope_id": emitter_id}).json()
    finding = editor_client.get(f"/ambiguity/runs/{run['id']}/findings").json()[0]
    resp = viewer_client.post(f"/ambiguity/findings/{finding['id']}/review", json={"reviewer_note": "nope"})
    assert resp.status_code == 403


def test_editor_can_review_and_unreview_finding(editor_client, emitter_with_two_overlapping_modes):
    emitter_id = emitter_with_two_overlapping_modes["emitter"]["id"]
    run = editor_client.post("/ambiguity/runs", json={"scope_type": "emitter", "scope_id": emitter_id}).json()
    finding = editor_client.get(f"/ambiguity/runs/{run['id']}/findings").json()[0]

    resp = editor_client.post(f"/ambiguity/findings/{finding['id']}/review", json={"reviewer_note": "Acceptable"})
    assert resp.status_code == 200
    assert resp.json()["reviewer_note"] == "Acceptable"
    assert resp.json()["reviewed_at"] is not None

    resp = editor_client.post(f"/ambiguity/findings/{finding['id']}/unreview")
    assert resp.status_code == 200
    assert resp.json()["reviewed_at"] is None


def test_platform_scope_run_finds_cross_emitter_ambiguity(editor_client, emitter_with_two_overlapping_modes):
    emitter1_id = emitter_with_two_overlapping_modes["emitter"]["id"]
    v1 = emitter_with_two_overlapping_modes["version"]

    emitter2 = editor_client.post("/emitters", json={"name": "Second Ambiguity Emitter"}).json()
    ew_group2 = editor_client.post(f"/emitters/{emitter2['id']}/ew-groups", json={"name": "Group B"}).json()
    source2 = editor_client.post(
        f"/emitters/{emitter2['id']}/sources", json={"name": "Source B", "source_date": "2025-01-01"}
    ).json()
    editor_client.post(
        f"/ew-groups/{ew_group2['id']}/modes",
        json={"source_id": source2["id"], "name": "Mode X", "pri_type": "fixed", "line": FIXED_LINE},
    )
    v2 = editor_client.post(f"/emitters/{emitter2['id']}/versions", json={}).json()

    platform = editor_client.post("/platforms", json={"name": "Ambiguity Platform"}).json()
    editor_client.post(
        f"/platforms/{platform['id']}/links", json={"emitter_id": emitter1_id, "emitter_version_id": v1["id"]}
    )
    editor_client.post(
        f"/platforms/{platform['id']}/links", json={"emitter_id": emitter2["id"], "emitter_version_id": v2["id"]}
    )
    platform_version = editor_client.post(f"/platforms/{platform['id']}/versions", json={}).json()

    run = editor_client.post("/ambiguity/runs", json={"scope_type": "platform", "scope_id": platform["id"]}).json()
    run = editor_client.get(f"/ambiguity/runs/{run['id']}").json()
    assert run["platform_version_id"] == platform_version["id"]

    findings = editor_client.get(f"/ambiguity/runs/{run['id']}/findings").json()
    # 3 modes total (Mode 1, Mode 2 in emitter1; Mode X in emitter2), all identical -> C(3,2) = 3 pairs
    assert len(findings) == 3
    cross_emitter = [
        f for f in findings if f["details"]["mode_a"]["emitter_id"] != f["details"]["mode_b"]["emitter_id"]
    ]
    assert len(cross_emitter) == 2
