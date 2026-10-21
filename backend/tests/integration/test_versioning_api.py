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
    # An added Mode says what it covers, not just "Added".
    assert entry["new_value"].startswith("Fixed · RF ")

    versions = editor_client.get(f"/emitters/{emitter_id}/versions").json()
    assert all(v["created_by_username"] for v in versions)


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


def test_modes_moved_out_of_a_deleted_ew_group_show_as_moved_not_removed(editor_client, emitter_ctx):
    emitter_id = emitter_ctx["emitter"]["id"]
    old_group = emitter_ctx["ew_group"]
    kept = _add_mode(editor_client, emitter_ctx, "Kept")
    _add_mode(editor_client, emitter_ctx, "Dropped")
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "v1"})

    new_group = editor_client.post(f"/emitters/{emitter_id}/ew-groups", json={"name": "Group B"}).json()
    moved = editor_client.patch(f"/ew-groups/{old_group['id']}/modes/{kept['id']}", json={"ew_group_id": new_group["id"]})
    assert moved.status_code == 200
    assert editor_client.delete(f"/emitters/{emitter_id}/ew-groups/{old_group['id']}").status_code == 204

    entries = editor_client.get(f"/emitters/{emitter_id}/diff/live").json()["entries"]
    by_scope = {(e["scope"], e["label"]): e for e in entries}
    assert by_scope[("Mode 'Kept'", "EW Group")]["old_value"] == "Group A"
    assert by_scope[("Mode 'Kept'", "EW Group")]["new_value"] == "Group B"
    assert ("Mode 'Kept'", "Removed") not in by_scope and ("Mode 'Kept'", "Added") not in by_scope
    # The Mode left in the deleted group really is gone.
    assert ("Mode 'Dropped'", "Removed") in by_scope
    assert by_scope[("EW Group 'Group A'", "Removed")]["old_value"] == "2 Modes (1 moved to other EW Groups)"


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


def test_status_transition_saves_no_version(editor_client, emitter_ctx):
    emitter_id = emitter_ctx["emitter"]["id"]
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "v1"})
    resp = editor_client.post(f"/emitters/{emitter_id}/status", json={"new_status": "in_review"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "in_review"
    # Where it stands, not its content: no version for it, the Audit Log has it.
    assert [v["version_number"] for v in editor_client.get(f"/emitters/{emitter_id}/versions").json()] == [1]
    rows = editor_client.get("/audit-log", params={"emitter_id": emitter_id}).json()["items"]
    # Written with the names people see, not the stored values.
    assert any("Status: In progress → Testing" in r["summary"] for r in rows)


def test_status_change_shows_status_names_in_the_version_diff(editor_client, emitter_ctx):
    emitter_id = emitter_ctx["emitter"]["id"]
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "v1"})
    editor_client.post(f"/emitters/{emitter_id}/status", json={"new_status": "in_review"})
    # Not an unsaved change...
    live = editor_client.get(f"/emitters/{emitter_id}/diff/live").json()
    assert live["identical"] is True
    # ...but the next saved version records it.
    editor_client.post(f"/emitters/{emitter_id}/checkout")
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "v2"})
    entries = editor_client.get(f"/emitters/{emitter_id}/versions/2/diff").json()["entries"]
    assert [(e["old_value"], e["new_value"]) for e in entries if e["label"] == "Status"] == [("In progress", "Testing")]


def test_status_transition_rejects_illegal_jump(editor_client, emitter_ctx):
    emitter_id = emitter_ctx["emitter"]["id"]
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "v1"})
    # draft -> validated is not a legal direct transition (must pass through in_review)
    resp = editor_client.post(f"/emitters/{emitter_id}/status", json={"new_status": "validated"})
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Cannot move from 'In progress' to 'Operational'"


def test_status_transition_rejects_unknown_status(editor_client, emitter_ctx):
    emitter_id = emitter_ctx["emitter"]["id"]
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "v1"})
    resp = editor_client.post(f"/emitters/{emitter_id}/status", json={"new_status": "nonexistent"})
    assert resp.status_code == 422


def test_status_can_change_before_a_version_is_saved(editor_client, emitter_ctx):
    resp = editor_client.post(f"/emitters/{emitter_ctx['emitter']['id']}/status", json={"new_status": "in_review"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "in_review"


def test_status_changes_without_the_checkout_and_leaves_unsaved_edits_alone(
    editor_client, admin_client, viewer_client, emitter_ctx
):
    emitter_id = emitter_ctx["emitter"]["id"]
    _add_mode(editor_client, emitter_ctx, "Saved Mode")
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "v1"})
    # The editor carries on editing: an unsaved Mode.
    editor_client.post(f"/emitters/{emitter_id}/checkout")
    _add_mode(editor_client, emitter_ctx, "Unsaved Mode")

    # Someone else moves it to Testing while it's checked out by the editor.
    resp = admin_client.post(f"/emitters/{emitter_id}/status", json={"new_status": "in_review"})
    assert resp.status_code == 200, resp.text
    assert len(admin_client.get(f"/emitters/{emitter_id}/versions").json()) == 1

    # The editor's unsaved work is still there; discarding it keeps the status.
    emitter = editor_client.get(f"/emitters/{emitter_id}").json()
    assert emitter["status"] == "in_review" and emitter["checked_out_by_username"] == "editor_t"
    assert editor_client.post(f"/emitters/{emitter_id}/discard").json()["status"] == "in_review"
    modes = editor_client.get(f"/emitters/{emitter_id}/modes").json()
    assert [m["name"] for m in modes] == ["Saved Mode"]
    # And a revert does too.
    editor_client.post(f"/emitters/{emitter_id}/checkout")
    editor_client.post(f"/emitters/{emitter_id}/versions/1/revert")
    assert editor_client.get(f"/emitters/{emitter_id}").json()["status"] == "in_review"

    # Still Editors only.
    assert viewer_client.post(f"/emitters/{emitter_id}/status", json={"new_status": "draft"}).status_code == 403


def test_viewer_cannot_commit_version(viewer_client, editor_client, emitter_ctx):
    resp = viewer_client.post(f"/emitters/{emitter_ctx['emitter']['id']}/versions", json={"change_summary": "test"})
    assert resp.status_code == 403


def test_partially_operational_sits_between_testing_and_operational(editor_client, emitter_ctx):
    emitter_id = emitter_ctx["emitter"]["id"]
    status_url = f"/emitters/{emitter_id}/status"
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "v1"})
    # Not straight from In progress.
    assert editor_client.post(status_url, json={"new_status": "partially_operational", "note": "x"}).status_code == 409
    editor_client.post(status_url, json={"new_status": "in_review"})

    # Has to say which part is operational.
    no_note = editor_client.post(status_url, json={"new_status": "partially_operational"})
    assert no_note.status_code == 422
    assert "Which part is operational?" in no_note.json()["detail"]

    resp = editor_client.post(status_url, json={"new_status": "partially_operational", "note": "Search Modes checked"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "partially_operational"

    # To Needs rework needs a note, as from Operational.
    rework = editor_client.post(status_url, json={"new_status": "deprecated"})
    assert rework.status_code == 422
    assert "moving to Needs rework" in rework.json()["detail"]

    done = editor_client.post(status_url, json={"new_status": "validated", "note": "All Modes checked"})
    assert done.status_code == 200, done.text
    back = editor_client.post(status_url, json={"new_status": "partially_operational", "note": "Track Modes changed"})
    assert back.status_code == 200, back.text
    assert editor_client.get(f"/emitters/{emitter_id}").json()["status"] == "partially_operational"


def test_diff_names_every_changed_mode_parameter(editor_client, emitter_ctx):
    emitter_id = emitter_ctx["emitter"]["id"]
    mode = _add_mode(editor_client, emitter_ctx)
    second = editor_client.post(
        f"/emitters/{emitter_id}/sources", json={"name": "Source B", "source_date": "2025-02-01"}
    ).json()
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "v1"})

    stagger_line = {
        **{k: v for k, v in FIXED_LINE.items() if not k.startswith(("pri_", "jitter_"))},
        "rf_max_mhz": 3200,
        "pw_range_matching": True,
        "pri_range_matching": False,
        "pri_stagger_values_us": [700, 750, 1200],
        "frame_time_delta_us": 4,
    }
    resp = editor_client.patch(
        f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes/{mode['id']}",
        json={
            "pri_type": "stagger",
            "line": stagger_line,
            "notes": "Seen at sea",
            "confirmation_quality": 60,
            "source_ids": [emitter_ctx["source"]["id"], second["id"]],
        },
    )
    assert resp.status_code == 200, resp.text

    # A stagger's values are a list: the diff once failed on them outright.
    live = editor_client.get(f"/emitters/{emitter_id}/diff/live")
    assert live.status_code == 200, live.text
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "v2"})
    diff = editor_client.get(f"/emitters/{emitter_id}/versions/2/diff")
    assert diff.status_code == 200, diff.text
    changed = {e["label"]: (e["old_value"], e["new_value"]) for e in diff.json()["entries"]}
    assert changed == {
        "PRI Type": ("Fixed", "Stagger"),
        "Notes": (None, "Seen at sea"),
        "Confirmation Quality (%)": (100, 60),
        "Sources": ("Source A", "Source A, Source B"),
        "RF Max (MHz)": (3100, 3200),
        "PW Range Matching": (False, True),
        "PRI Min (µs)": (800, None),
        "PRI Max (µs)": (1200, None),
        "Jitter Min (µs)": (5, None),
        "Jitter Max (µs)": (15, None),
        "PRI Delta (±µs)": (10, None),
        "Stagger Values (µs)": (None, [700, 750, 1200]),
        "Frame Time Delta (±µs)": (None, 4),
    }
    assert live.json()["entries"] == diff.json()["entries"]


def test_diff_tells_same_named_modes_in_two_ew_groups_apart(editor_client, emitter_ctx):
    emitter_id = emitter_ctx["emitter"]["id"]
    mode = _add_mode(editor_client, emitter_ctx, name="Search")
    other = editor_client.post(f"/emitters/{emitter_id}/ew-groups", json={"name": "Group B"}).json()
    editor_client.post(
        f"/ew-groups/{other['id']}/modes",
        json={"source_id": emitter_ctx["source"]["id"], "name": "Search", "pri_type": "fixed", "line": FIXED_LINE},
    )
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "v1"})
    editor_client.patch(f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes/{mode['id']}", json={"notes": "only this one"})
    entries = editor_client.get(f"/emitters/{emitter_id}/diff/live").json()["entries"]
    assert [(e["scope"], e["label"]) for e in entries] == [("Mode 'Search (Group A)'", "Notes")]
