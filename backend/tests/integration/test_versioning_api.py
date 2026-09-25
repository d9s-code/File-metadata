import pytest


@pytest.fixture()
def emitter_ctx(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Versioned Emitter"}).json()
    ew_group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Group A"}).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Source A", "source_date": "2025-01-01"}
    ).json()
    return {"emitter": emitter, "ew_group": ew_group, "source": source}


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


def _add_mode(editor_client, ctx, name="Mode 1"):
    return editor_client.post(
        f"/ew-groups/{ctx['ew_group']['id']}/modes",
        json={"source_id": ctx["source"]["id"], "name": name, "pri_type": "fixed", "line": FIXED_LINE},
    ).json()


def test_commit_creates_monotonic_versions(editor_client, emitter_ctx):
    v1 = editor_client.post(f"/emitters/{emitter_ctx['emitter']['id']}/versions", json={"change_summary": "test"}).json()
    assert v1["version_number"] == 1

    v2 = editor_client.post(f"/emitters/{emitter_ctx['emitter']['id']}/versions", json={"change_summary": "test"}).json()
    assert v2["version_number"] == 2

    versions = editor_client.get(f"/emitters/{emitter_ctx['emitter']['id']}/versions").json()
    assert [v["version_number"] for v in versions] == [1, 2]


def test_diff_shows_exactly_one_field_changed(editor_client, emitter_ctx):
    emitter_id = emitter_ctx["emitter"]["id"]
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "test"})  # v1

    editor_client.patch(f"/emitters/{emitter_id}", json={"description": "Updated description"})
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "test"})  # v2

    diff = editor_client.get(f"/emitters/{emitter_id}/versions/2/diff").json()
    assert diff["identical"] is False
    assert len(diff["entries"]) == 1
    entry = diff["entries"][0]
    assert entry["scope"] == "Emitter"
    assert entry["label"] == "Description"
    assert entry["kind"] == "changed"
    assert entry["new_value"] == "Updated description"


def test_diff_shows_added_mode_not_spurious_field_noise(editor_client, emitter_ctx):
    emitter_id = emitter_ctx["emitter"]["id"]
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "test"})  # v1, no modes

    _add_mode(editor_client, emitter_ctx)
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "test"})  # v2, one mode

    diff = editor_client.get(f"/emitters/{emitter_id}/versions/2/diff").json()
    assert len(diff["entries"]) == 1
    entry = diff["entries"][0]
    assert entry["scope"] == "Mode 'Mode 1'"
    assert entry["kind"] == "added"


def test_live_diff_shows_mode_added_inside_a_brand_new_ew_group(editor_client, emitter_ctx):
    # Regression test: _diff_modes was only ever called for EW Groups
    # present in both snapshots, so a Mode created inside a brand-new
    # (uncommitted) EW Group was never itemized — only "EW Group Added" was.
    emitter_id = emitter_ctx["emitter"]["id"]
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "v1"})

    new_group = editor_client.post(f"/emitters/{emitter_id}/ew-groups", json={"name": "New Group"}).json()
    editor_client.post(
        f"/ew-groups/{new_group['id']}/modes",
        json={"source_id": emitter_ctx["source"]["id"], "name": "New Mode", "pri_type": "fixed", "line": FIXED_LINE},
    )

    diff = editor_client.get(f"/emitters/{emitter_id}/diff/live").json()
    scopes = {(e["scope"], e["kind"]) for e in diff["entries"]}
    assert ("EW Group 'New Group'", "added") in scopes
    assert ("Mode 'New Mode'", "added") in scopes


def test_diff_against_specific_version(editor_client, emitter_ctx):
    emitter_id = emitter_ctx["emitter"]["id"]
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "test"})  # v1
    editor_client.patch(f"/emitters/{emitter_id}", json={"description": "v2 desc"})
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "test"})  # v2
    editor_client.patch(f"/emitters/{emitter_id}", json={"description": "v3 desc"})
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "test"})  # v3

    diff_1_to_3 = editor_client.get(f"/emitters/{emitter_id}/versions/3/diff?against=1").json()
    assert diff_1_to_3["entries"][0]["old_value"] is None
    assert diff_1_to_3["entries"][0]["new_value"] == "v3 desc"


def test_diff_with_no_prior_version_is_400(editor_client, emitter_ctx):
    emitter_id = emitter_ctx["emitter"]["id"]
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "test"})  # v1
    resp = editor_client.get(f"/emitters/{emitter_id}/versions/1/diff")
    assert resp.status_code == 400


def test_live_diff_before_any_commit_shows_everything_as_added(editor_client, emitter_ctx):
    emitter_id = emitter_ctx["emitter"]["id"]
    resp = editor_client.get(f"/emitters/{emitter_id}/diff/live")
    assert resp.status_code == 200
    body = resp.json()
    assert body["identical"] is False
    assert any(e["scope"] == "Emitter" and e["label"] == "Name" for e in body["entries"])


def test_live_diff_shows_uncommitted_change_and_clears_after_commit(editor_client, emitter_ctx):
    emitter_id = emitter_ctx["emitter"]["id"]
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "v1"})

    identical = editor_client.get(f"/emitters/{emitter_id}/diff/live").json()
    assert identical["identical"] is True

    editor_client.patch(f"/emitters/{emitter_id}", json={"description": "uncommitted edit"})
    dirty = editor_client.get(f"/emitters/{emitter_id}/diff/live").json()
    assert dirty["identical"] is False
    assert any(e["scope"] == "Emitter" and e["label"] == "Description" for e in dirty["entries"])

    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "v2"})
    clean_again = editor_client.get(f"/emitters/{emitter_id}/diff/live").json()
    assert clean_again["identical"] is True


def test_status_transition_commits_a_version(editor_client, emitter_ctx):
    emitter_id = emitter_ctx["emitter"]["id"]
    resp = editor_client.post(f"/emitters/{emitter_id}/status", json={"new_status": "in_review"})
    assert resp.status_code == 200, resp.text
    version = resp.json()
    assert version["version_number"] == 1
    # Written with the names people see, not the stored values.
    assert version["change_summary"] == "Status: In progress → Testing"

    emitter = editor_client.get(f"/emitters/{emitter_id}").json()
    assert emitter["status"] == "in_review"


def test_status_change_shows_status_names_in_the_version_diff(editor_client, emitter_ctx):
    emitter_id = emitter_ctx["emitter"]["id"]
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "v1"})
    editor_client.post(f"/emitters/{emitter_id}/status", json={"new_status": "in_review"})
    entries = editor_client.get(f"/emitters/{emitter_id}/versions/2/diff").json()["entries"]
    assert [(e["old_value"], e["new_value"]) for e in entries if e["label"] == "Status"] == [("In progress", "Testing")]


def test_status_transition_rejects_illegal_jump(editor_client, emitter_ctx):
    emitter_id = emitter_ctx["emitter"]["id"]
    # draft -> validated is not a legal direct transition (must pass through in_review)
    resp = editor_client.post(f"/emitters/{emitter_id}/status", json={"new_status": "validated"})
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Cannot move from 'In progress' to 'Operational'"


def test_status_transition_rejects_unknown_status(editor_client, emitter_ctx):
    emitter_id = emitter_ctx["emitter"]["id"]
    resp = editor_client.post(f"/emitters/{emitter_id}/status", json={"new_status": "nonexistent"})
    assert resp.status_code == 422


def test_viewer_cannot_commit_version(viewer_client, editor_client, emitter_ctx):
    resp = viewer_client.post(f"/emitters/{emitter_ctx['emitter']['id']}/versions", json={"change_summary": "test"})
    assert resp.status_code == 403
