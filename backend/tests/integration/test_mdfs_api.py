import pytest


@pytest.fixture()
def platform_with_version(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "MDF Test Emitter"}).json()
    emitter_v1 = editor_client.post(f"/emitters/{emitter['id']}/versions", json={}).json()

    platform = editor_client.post("/platforms", json={"name": "MDF Test Platform"}).json()
    editor_client.post(
        f"/platforms/{platform['id']}/links",
        json={"emitter_id": emitter["id"], "emitter_version_id": emitter_v1["id"]},
    )
    platform_v1 = editor_client.post(f"/platforms/{platform['id']}/versions", json={}).json()
    return {"emitter": emitter, "platform": platform, "platform_version": platform_v1}


def test_create_mdf(editor_client):
    resp = editor_client.post("/mdfs", json={"name": "MDF Alpha", "description": "Test MDF"})
    assert resp.status_code == 201, resp.text
    assert resp.json()["status"] == "draft"


def test_pin_requires_committed_platform_version(editor_client):
    mdf = editor_client.post("/mdfs", json={"name": "No Commit MDF"}).json()
    platform = editor_client.post("/platforms", json={"name": "Uncommitted Platform"}).json()
    import uuid

    resp = editor_client.post(
        f"/mdfs/{mdf['id']}/links",
        json={"platform_id": platform["id"], "platform_version_id": str(uuid.uuid4())},
    )
    assert resp.status_code == 422


def test_pin_platform_and_commit_mdf_version(editor_client, platform_with_version):
    mdf = editor_client.post("/mdfs", json={"name": "MDF With Platform"}).json()
    resp = editor_client.post(
        f"/mdfs/{mdf['id']}/links",
        json={
            "platform_id": platform_with_version["platform"]["id"],
            "platform_version_id": platform_with_version["platform_version"]["id"],
        },
    )
    assert resp.status_code == 201, resp.text

    version = editor_client.post(f"/mdfs/{mdf['id']}/versions", json={}).json()
    assert version["version_number"] == 1

    detail = editor_client.get(f"/mdfs/{mdf['id']}/versions/1").json()
    assert detail["snapshot"]["links"][0]["platform_name"] == "MDF Test Platform"
    # Transitively includes the pinned emitter's data via the platform snapshot
    assert (
        detail["snapshot"]["links"][0]["platform_snapshot"]["links"][0]["emitter_name"] == "MDF Test Emitter"
    )


def test_readiness_warns_on_unvalidated_emitter_and_no_test(editor_client, platform_with_version):
    mdf = editor_client.post("/mdfs", json={"name": "MDF Readiness"}).json()
    editor_client.post(
        f"/mdfs/{mdf['id']}/links",
        json={
            "platform_id": platform_with_version["platform"]["id"],
            "platform_version_id": platform_with_version["platform_version"]["id"],
        },
    )
    resp = editor_client.get(f"/mdfs/{mdf['id']}/status/readiness")
    assert resp.status_code == 200
    warnings = resp.json()["warnings"]
    assert any("not yet 'validated'" in w for w in warnings)
    assert any("No passing test on file" in w for w in warnings)


def test_readiness_clears_once_emitter_validated_and_test_passes(editor_client, platform_with_version):
    emitter_id = platform_with_version["emitter"]["id"]
    # Move the emitter through draft -> in_review -> validated
    editor_client.post(f"/emitters/{emitter_id}/status", json={"new_status": "in_review"})
    editor_client.post(f"/emitters/{emitter_id}/status", json={"new_status": "validated"})

    # Re-pin the platform to a version that reflects the now-validated emitter, then re-commit the platform
    new_emitter_version = editor_client.get(f"/emitters/{emitter_id}/versions").json()[-1]
    editor_client.post(
        f"/platforms/{platform_with_version['platform']['id']}/links",
        json={"emitter_id": emitter_id, "emitter_version_id": new_emitter_version["id"]},
    )
    new_platform_version = editor_client.post(
        f"/platforms/{platform_with_version['platform']['id']}/versions", json={}
    ).json()

    mdf = editor_client.post("/mdfs", json={"name": "MDF Readiness Clear"}).json()
    editor_client.post(
        f"/mdfs/{mdf['id']}/links",
        json={"platform_id": platform_with_version["platform"]["id"], "platform_version_id": new_platform_version["id"]},
    )
    editor_client.post(
        f"/mdfs/{mdf['id']}/test-records",
        json={
            "test_type": "simulation",
            "result": "pass",
            "title": "Sim run 1",
            "test_date": "2025-06-01",
            "simulation_created_date": "2025-05-01",
        },
    )

    resp = editor_client.get(f"/mdfs/{mdf['id']}/status/readiness")
    assert resp.json()["warnings"] == []


def test_status_transition_includes_warnings_but_still_succeeds(editor_client, platform_with_version):
    mdf = editor_client.post("/mdfs", json={"name": "MDF Transition"}).json()
    editor_client.post(
        f"/mdfs/{mdf['id']}/links",
        json={
            "platform_id": platform_with_version["platform"]["id"],
            "platform_version_id": platform_with_version["platform_version"]["id"],
        },
    )
    resp = editor_client.post(f"/mdfs/{mdf['id']}/status", json={"new_status": "pending_review"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["warnings"]) > 0
    assert editor_client.get(f"/mdfs/{mdf['id']}").json()["status"] == "pending_review"


def test_mdf_pinning_survives_new_platform_version(editor_client, platform_with_version):
    mdf = editor_client.post("/mdfs", json={"name": "MDF Stable Pin"}).json()
    platform_id = platform_with_version["platform"]["id"]
    v1 = platform_with_version["platform_version"]

    editor_client.post(f"/mdfs/{mdf['id']}/links", json={"platform_id": platform_id, "platform_version_id": v1["id"]})

    editor_client.patch(f"/platforms/{platform_id}", json={"description": "changed after MDF pin"})
    editor_client.post(f"/platforms/{platform_id}/versions", json={})  # v2, unrelated to the MDF's pin

    links = editor_client.get(f"/mdfs/{mdf['id']}/links").json()
    assert links[0]["platform_version_id"] == v1["id"]


def test_test_record_pins_to_latest_committed_version(editor_client, platform_with_version):
    emitter_id = platform_with_version["emitter"]["id"]
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={"test_type": "lab_bench", "result": "fail", "title": "Bench check", "test_date": "2025-05-01"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["emitter_version_id"] is not None
    assert body["scope_type"] == "emitter"


def test_viewer_cannot_create_test_record(viewer_client, platform_with_version):
    emitter_id = platform_with_version["emitter"]["id"]
    resp = viewer_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={"test_type": "lab_bench", "result": "fail", "title": "Bench check", "test_date": "2025-05-01"},
    )
    assert resp.status_code == 403
