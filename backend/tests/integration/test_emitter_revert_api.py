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


def _setup_emitter_with_two_versions(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Revert Emitter"}).json()
    ew_group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Group R"}).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Source R", "source_date": "2025-01-01"}
    ).json()
    editor_client.post(f"/emitters/{emitter['id']}/versions", json={"change_summary": "v1: empty"})

    mode = editor_client.post(
        f"/ew-groups/{ew_group['id']}/modes",
        json={"source_id": source["id"], "name": "Mode R", "pri_type": "fixed", "line": FIXED_LINE},
    ).json()
    editor_client.post(f"/emitters/{emitter['id']}/versions", json={"change_summary": "v2: added Mode R"})

    return {"emitter": emitter, "ew_group": ew_group, "source": source, "mode": mode}


def test_revert_reconciles_live_state_and_commits_new_version(editor_client):
    ctx = _setup_emitter_with_two_versions(editor_client)
    emitter_id = ctx["emitter"]["id"]

    resp = editor_client.post(f"/emitters/{emitter_id}/versions/1/revert")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["version_number"] == 3
    assert "Reverted to version 1" in body["change_summary"]

    modes = editor_client.get(f"/emitters/{emitter_id}/modes").json()
    assert modes == []

    versions = editor_client.get(f"/emitters/{emitter_id}/versions").json()
    assert [v["version_number"] for v in versions] == [1, 2, 3]


def test_revert_preserves_mode_id_for_surviving_mode(editor_client):
    ctx = _setup_emitter_with_two_versions(editor_client)
    emitter_id = ctx["emitter"]["id"]
    mode_id = ctx["mode"]["id"]

    # Mutate the mode's line, then revert back to v2 (which already has this
    # exact mode) -- the mode's id must be preserved, not recreated.
    editor_client.patch(
        f"/ew-groups/{ctx['ew_group']['id']}/modes/{mode_id}", json={"notes": "changed after v2"}
    )
    resp = editor_client.post(f"/emitters/{emitter_id}/versions/2/revert")
    assert resp.status_code == 200, resp.text

    modes = editor_client.get(f"/emitters/{emitter_id}/modes").json()
    assert len(modes) == 1
    assert modes[0]["id"] == mode_id
    assert modes[0]["notes"] is None


def test_revert_deletes_mode_not_in_target_and_cascades_test_record(editor_client):
    ctx = _setup_emitter_with_two_versions(editor_client)
    emitter_id = ctx["emitter"]["id"]
    mode_id = ctx["mode"]["id"]

    test_record = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "intercept",
            "title": "Bench check",
            "test_date": "2025-05-01",
            "mode_results": [{"mode_id": mode_id, "result": "pass"}],
        },
    ).json()
    assert test_record["id"]

    resp = editor_client.post(f"/emitters/{emitter_id}/versions/1/revert")
    assert resp.status_code == 200, resp.text

    modes = editor_client.get(f"/emitters/{emitter_id}/modes").json()
    assert modes == []


def test_revert_deletes_an_entire_ew_group_and_source_not_in_target(editor_client):
    ctx = _setup_emitter_with_two_versions(editor_client)
    emitter_id = ctx["emitter"]["id"]

    # Add a whole second EW Group + Source + Mode after v2, then commit v3.
    extra_group = editor_client.post(f"/emitters/{emitter_id}/ew-groups", json={"name": "Extra Group"}).json()
    extra_source = editor_client.post(
        f"/emitters/{emitter_id}/sources", json={"name": "Extra Source", "source_date": "2025-01-01"}
    ).json()
    editor_client.post(
        f"/ew-groups/{extra_group['id']}/modes",
        json={"source_id": extra_source["id"], "name": "Extra Mode", "pri_type": "fixed", "line": FIXED_LINE},
    )
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "v3: added a whole second group"})

    resp = editor_client.post(f"/emitters/{emitter_id}/versions/2/revert")
    assert resp.status_code == 200, resp.text

    ew_groups = editor_client.get(f"/emitters/{emitter_id}/ew-groups").json()
    assert [g["id"] for g in ew_groups] == [ctx["ew_group"]["id"]]

    sources = editor_client.get(f"/emitters/{emitter_id}/sources").json()
    assert [s["id"] for s in sources] == [ctx["source"]["id"]]

    modes = editor_client.get(f"/emitters/{emitter_id}/modes").json()
    assert [m["id"] for m in modes] == [ctx["mode"]["id"]]


def test_revert_when_checked_out_by_someone_else_is_409(editor_client, admin_client):
    ctx = _setup_emitter_with_two_versions(editor_client)
    emitter_id = ctx["emitter"]["id"]
    # editor_client still holds the checkout from creation.
    resp = admin_client.post(f"/emitters/{emitter_id}/versions/1/revert")
    assert resp.status_code == 409


def test_revert_missing_version_is_404(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "No Version Revert Emitter"}).json()
    resp = editor_client.post(f"/emitters/{emitter['id']}/versions/99/revert")
    assert resp.status_code == 404


def test_discard_reconciles_to_latest_commit_without_new_version(editor_client):
    ctx = _setup_emitter_with_two_versions(editor_client)
    emitter_id = ctx["emitter"]["id"]

    editor_client.patch(f"/emitters/{emitter_id}", json={"description": "uncommitted edit"})
    resp = editor_client.post(f"/emitters/{emitter_id}/discard")
    assert resp.status_code == 200, resp.text
    assert resp.json()["description"] is None
    assert resp.json()["checked_out_by_id"] is None

    versions = editor_client.get(f"/emitters/{emitter_id}/versions").json()
    assert len(versions) == 2


def test_discard_without_checkout_is_409(editor_client, admin_client):
    ctx = _setup_emitter_with_two_versions(editor_client)
    emitter_id = ctx["emitter"]["id"]
    resp = admin_client.post(f"/emitters/{emitter_id}/discard")
    assert resp.status_code == 409


def test_discard_with_no_committed_version_is_409(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "No Commit Discard Emitter"}).json()
    resp = editor_client.post(f"/emitters/{emitter['id']}/discard")
    assert resp.status_code == 409


def test_discard_reverts_an_uncommitted_function_group_assignment(editor_client):
    # Regression test: reconcile_emitter_to_snapshot used to leave
    # Mode.function_group_id untouched entirely, so a batch-edit assignment
    # survived both discard and revert instead of being rolled back with
    # everything else.
    ctx = _setup_emitter_with_two_versions(editor_client)
    emitter_id = ctx["emitter"]["id"]
    mode_id = ctx["mode"]["id"]

    fg = editor_client.post(f"/emitters/{emitter_id}/function-groups", json={"name": "FG"}).json()
    editor_client.post(
        f"/emitters/{emitter_id}/modes/batch-edit",
        json={"mode_ids": [mode_id], "fields": {"function_group_id": fg["id"]}},
    )
    modes = editor_client.get(f"/emitters/{emitter_id}/modes").json()
    assert modes[0]["function_group_id"] == fg["id"]

    resp = editor_client.post(f"/emitters/{emitter_id}/discard")
    assert resp.status_code == 200, resp.text

    modes = editor_client.get(f"/emitters/{emitter_id}/modes").json()
    assert modes[0]["function_group_id"] is None


def test_revert_to_pre_fork_version_is_409(editor_client):
    ctx = _setup_emitter_with_two_versions(editor_client)
    emitter_id = ctx["emitter"]["id"]

    forked = editor_client.post(
        f"/emitters/{emitter_id}/versions/2/fork", json={"new_name": "Revert-Blocked Fork"}
    ).json()
    forked_id = forked["id"]
    assert forked["forked_at_version_number"] == 2

    # Version 1 was copied in from the source Emitter — its EW-Group/Source/
    # Mode ids belong to the source's still-live rows, not this fork's.
    resp = editor_client.post(f"/emitters/{forked_id}/versions/1/revert")
    assert resp.status_code == 409

    # The fork's own commit (version 3: 1 and 2 copied, then the fork
    # itself) is a real version of this Emitter and reverts normally.
    resp = editor_client.post(f"/emitters/{forked_id}/versions/3/revert")
    assert resp.status_code == 200, resp.text
