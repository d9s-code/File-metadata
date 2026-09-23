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
    emitter = editor_client.post("/emitters", json={"name": "Sim Test Emitter"}).json()
    ew_group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Group A"}).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Source A", "source_date": "2025-01-01"}
    ).json()
    mode = editor_client.post(
        f"/ew-groups/{ew_group['id']}/modes",
        json={"source_id": source["id"], "name": "Mode 1", "pri_type": "fixed", "line": FIXED_LINE},
    ).json()
    return {"emitter": emitter, "mode": mode}


def test_import_test_lines(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    mode_id = emitter_with_mode["mode"]["id"]
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-lines/import",
        json={
            "lines": [
                {"label": "Threat 3, high-PRF search", "expected_mode_id": mode_id},
                {"label": "Threat 3, low-PRF search"},
            ],
            "batch_label": "2026-09 threat table",
            "created_date": "2026-09-15",
        },
    )
    assert resp.status_code == 201, resp.text
    lines = resp.json()
    assert len(lines) == 2
    assert lines[0]["expected_mode_name"] == "Mode 1"
    assert lines[0]["import_batch_label"] == "2026-09 threat table"
    assert lines[1]["expected_mode_id"] is None

    listed = editor_client.get(f"/emitters/{emitter_id}/test-lines").json()
    assert len(listed) == 2


def test_import_test_lines_rejects_unknown_mode(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-lines/import",
        json={"created_date": "2026-09-15", "lines": [{"label": "X", "expected_mode_id": "00000000-0000-0000-0000-000000000000"}]},
    )
    assert resp.status_code == 404


def test_import_test_lines_rejects_empty_list(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    resp = editor_client.post(f"/emitters/{emitter_id}/test-lines/import", json={"created_date": "2026-09-15", "lines": []})
    assert resp.status_code == 422


def test_viewer_cannot_import_test_lines(viewer_client, editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    resp = viewer_client.post(f"/emitters/{emitter_id}/test-lines/import", json={"created_date": "2026-09-15", "lines": [{"label": "X"}]})
    assert resp.status_code == 403


def test_delete_test_line(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    line = editor_client.post(
        f"/emitters/{emitter_id}/test-lines/import", json={"created_date": "2026-09-15", "lines": [{"label": "X"}]}
    ).json()[0]
    resp = editor_client.delete(f"/emitters/{emitter_id}/test-lines/{line['id']}")
    assert resp.status_code == 204
    assert editor_client.get(f"/emitters/{emitter_id}/test-lines").json() == []


def test_update_test_line_label_and_mode(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    mode_id = emitter_with_mode["mode"]["id"]
    line = editor_client.post(f"/emitters/{emitter_id}/test-lines/import", json={"created_date": "2026-09-15", "lines": [{"label": "X"}]}).json()[0]
    original_updated_at = line["updated_at"]

    resp = editor_client.patch(
        f"/emitters/{emitter_id}/test-lines/{line['id']}",
        json={"label": "Renamed line", "expected_mode_id": mode_id},
    )
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["label"] == "Renamed line"
    assert updated["expected_mode_id"] == mode_id
    assert updated["expected_mode_name"] == "Mode 1"
    assert updated["updated_at"] != original_updated_at

    listed = editor_client.get(f"/emitters/{emitter_id}/test-lines").json()[0]
    assert listed["label"] == "Renamed line"


def test_update_test_line_can_clear_expected_mode(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    mode_id = emitter_with_mode["mode"]["id"]
    line = editor_client.post(
        f"/emitters/{emitter_id}/test-lines/import", json={"created_date": "2026-09-15", "lines": [{"label": "X", "expected_mode_id": mode_id}]}
    ).json()[0]
    resp = editor_client.patch(f"/emitters/{emitter_id}/test-lines/{line['id']}", json={"expected_mode_id": None})
    assert resp.status_code == 200, resp.text
    assert resp.json()["expected_mode_id"] is None


def test_update_test_line_rejects_unknown_mode(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    line = editor_client.post(f"/emitters/{emitter_id}/test-lines/import", json={"created_date": "2026-09-15", "lines": [{"label": "X"}]}).json()[0]
    resp = editor_client.patch(
        f"/emitters/{emitter_id}/test-lines/{line['id']}",
        json={"expected_mode_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert resp.status_code == 404


def test_update_test_line_is_audited(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    line = editor_client.post(f"/emitters/{emitter_id}/test-lines/import", json={"created_date": "2026-09-15", "lines": [{"label": "X"}]}).json()[0]
    editor_client.patch(f"/emitters/{emitter_id}/test-lines/{line['id']}", json={"label": "Y"})
    audit = editor_client.get("/audit-log", params={"emitter_id": emitter_id, "entity_type": "test_line"}).json()
    update_entries = [e for e in audit["items"] if e["action"] == "update"]
    assert len(update_entries) == 1
    assert update_entries[0]["changes"]["label"] == {"old": "X", "new": "Y"}


def test_import_test_lines_is_audited_under_emitter_rollup(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    editor_client.post(f"/emitters/{emitter_id}/test-lines/import", json={"created_date": "2026-09-15", "lines": [{"label": "X"}, {"label": "Y"}]})
    audit = editor_client.get("/audit-log", params={"emitter_id": emitter_id, "entity_type": "test_line"}).json()
    create_entries = [e for e in audit["items"] if e["action"] == "create"]
    assert len(create_entries) == 1
    assert "2 SIM Test Line" in create_entries[0]["summary"]


def test_import_update_delete_require_checkout(editor_client, admin_client, emitter_with_mode):
    # Test Lines are part of the Emitter's own versioned definition — same
    # checkout gate as a Mode or Source. Release the checkout (the fixture's
    # own Mode creation left it held by editor_client) and confirm every
    # mutating endpoint now 409s instead of succeeding.
    emitter_id = emitter_with_mode["emitter"]["id"]
    line = editor_client.post(f"/emitters/{emitter_id}/test-lines/import", json={"created_date": "2026-09-15", "lines": [{"label": "X"}]}).json()[0]
    editor_client.delete(f"/emitters/{emitter_id}/checkout")
    assert editor_client.get(f"/emitters/{emitter_id}").json()["checked_out_by_id"] is None

    resp = editor_client.post(f"/emitters/{emitter_id}/test-lines/import", json={"created_date": "2026-09-15", "lines": [{"label": "Y"}]})
    assert resp.status_code == 409

    resp = editor_client.patch(f"/emitters/{emitter_id}/test-lines/{line['id']}", json={"label": "Z"})
    assert resp.status_code == 409

    resp = editor_client.delete(f"/emitters/{emitter_id}/test-lines/{line['id']}")
    assert resp.status_code == 409

    # Listing stays read-only/unaffected by checkout.
    assert editor_client.get(f"/emitters/{emitter_id}/test-lines").json()[0]["label"] == "X"


def test_import_rejects_mode_from_another_emitter(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    other = editor_client.post("/emitters", json={"name": "Other Owning Emitter"}).json()
    other_ew_group = editor_client.post(f"/emitters/{other['id']}/ew-groups", json={"name": "Group B"}).json()
    other_source = editor_client.post(
        f"/emitters/{other['id']}/sources", json={"name": "Source B", "source_date": "2025-01-01"}
    ).json()
    other_mode = editor_client.post(
        f"/ew-groups/{other_ew_group['id']}/modes",
        json={"source_id": other_source["id"], "name": "Other Mode", "pri_type": "fixed", "line": FIXED_LINE},
    ).json()
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-lines/import",
        json={"created_date": "2026-09-15", "lines": [{"label": "X", "expected_mode_id": other_mode["id"]}]},
    )
    assert resp.status_code == 404


def test_test_lines_show_in_live_diff_and_clear_after_commit(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    before = editor_client.get(f"/emitters/{emitter_id}/diff/live").json()
    assert not any("Test Line" in e["scope"] for e in before["entries"])

    editor_client.post(f"/emitters/{emitter_id}/test-lines/import", json={"created_date": "2026-09-15", "lines": [{"label": "Threat X"}]})
    dirty = editor_client.get(f"/emitters/{emitter_id}/diff/live").json()
    matches = [e for e in dirty["entries"] if e["scope"] == "Test Line 'Threat X'"]
    assert len(matches) == 1
    assert matches[0]["kind"] == "added"

    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "commit test line"})
    clean = editor_client.get(f"/emitters/{emitter_id}/diff/live").json()
    assert not any("Test Line" in e["scope"] for e in clean["entries"])

    version_number = editor_client.get(f"/emitters/{emitter_id}/versions").json()[-1]["version_number"]
    version = editor_client.get(f"/emitters/{emitter_id}/versions/{version_number}").json()
    assert version["snapshot"]["test_lines"][0]["label"] == "Threat X"


def test_revert_restores_test_lines_and_drops_uncommitted_ones(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "v1: no lines"})

    editor_client.post(f"/emitters/{emitter_id}/test-lines/import", json={"created_date": "2026-09-15", "lines": [{"label": "Only in v2"}]})
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "v2: one line"})

    resp = editor_client.post(f"/emitters/{emitter_id}/versions/1/revert")
    assert resp.status_code == 200, resp.text
    assert editor_client.get(f"/emitters/{emitter_id}/test-lines").json() == []


def test_revert_preserves_test_line_id_and_restores_edited_label(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    line = editor_client.post(
        f"/emitters/{emitter_id}/test-lines/import", json={"created_date": "2026-09-15", "lines": [{"label": "Original label"}]}
    ).json()[0]
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "v1: original label"})

    editor_client.patch(f"/emitters/{emitter_id}/test-lines/{line['id']}", json={"label": "Edited label"})
    editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "v2: edited label"})

    resp = editor_client.post(f"/emitters/{emitter_id}/versions/1/revert")
    assert resp.status_code == 200, resp.text
    restored = editor_client.get(f"/emitters/{emitter_id}/test-lines").json()
    assert len(restored) == 1
    assert restored[0]["id"] == line["id"]
    assert restored[0]["label"] == "Original label"


def test_fork_copies_test_lines_with_remapped_expected_mode(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    mode_id = emitter_with_mode["mode"]["id"]
    editor_client.post(
        f"/emitters/{emitter_id}/test-lines/import",
        json={"created_date": "2026-09-15", "lines": [{"label": "Forked line", "expected_mode_id": mode_id}]},
    )
    version = editor_client.post(f"/emitters/{emitter_id}/versions", json={"change_summary": "v1"}).json()

    resp = editor_client.post(
        f"/emitters/{emitter_id}/versions/{version['version_number']}/fork", json={"new_name": "Forked Sim Emitter"}
    )
    assert resp.status_code == 201, resp.text
    forked = resp.json()

    forked_lines = editor_client.get(f"/emitters/{forked['id']}/test-lines").json()
    assert len(forked_lines) == 1
    assert forked_lines[0]["label"] == "Forked line"
    assert forked_lines[0]["expected_mode_id"] != mode_id  # fresh id, not the source Emitter's
    forked_modes = editor_client.get(f"/emitters/{forked['id']}/modes").json()
    assert forked_lines[0]["expected_mode_id"] == forked_modes[0]["id"]


def _import_lines(client, emitter_id, labels):
    resp = client.post(f"/emitters/{emitter_id}/test-lines/import", json={"created_date": "2026-09-15", "lines": [{"label": lbl} for lbl in labels]})
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_create_test_record_with_line_results_derives_worst_of(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    lines = _import_lines(editor_client, emitter_id, ["Line A", "Line B", "Line C"])
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "simulation",
            "title": "Sim run 1",
            "test_date": "2026-09-22",
            "simulation_created_date": "2026-09-01",
            "line_results": [
                {"test_line_id": lines[0]["id"], "outcome": "pass"},
                {"test_line_id": lines[1]["id"], "outcome": "partial", "intercepted_mode_ids": [emitter_with_mode["mode"]["id"]]},
                {"test_line_id": lines[2]["id"], "outcome": "pass"},
            ],
        },
    )
    assert resp.status_code == 201, resp.text
    record = resp.json()
    assert record["result"] == "partial"
    assert len(record["lines"]) == 3
    by_label = {ln["test_line_label"]: ln for ln in record["lines"]}
    assert by_label["Line B"]["outcome"] == "partial"
    assert [m["mode_id"] for m in by_label["Line B"]["intercepted_modes"]] == [emitter_with_mode["mode"]["id"]]
    assert by_label["Line B"]["intercepted_modes"][0]["mode_name"] == "Mode 1"


def test_line_results_take_precedence_over_mode_results(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    mode_id = emitter_with_mode["mode"]["id"]
    lines = _import_lines(editor_client, emitter_id, ["Line A"])
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "intercept",
            "title": "Mixed test",
            "test_date": "2026-09-22",
            "line_results": [{"test_line_id": lines[0]["id"], "outcome": "pass"}],
            "mode_results": [{"mode_id": mode_id, "result": "fail"}],
        },
    )
    assert resp.status_code == 201, resp.text
    # line_results (all pass) wins over mode_results (fail) per the documented precedence.
    assert resp.json()["result"] == "pass"


def test_create_test_record_rejects_unknown_test_line_id(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "simulation",
            "title": "Bad line",
            "test_date": "2026-09-22",
            "simulation_created_date": "2026-09-01",
            "line_results": [{"test_line_id": "00000000-0000-0000-0000-000000000000", "outcome": "pass"}],
        },
    )
    assert resp.status_code == 404


def test_create_test_record_rejects_test_line_from_another_emitter(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    other_emitter = editor_client.post("/emitters", json={"name": "Other Emitter"}).json()
    other_lines = _import_lines(editor_client, other_emitter["id"], ["Other Line"])
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "simulation",
            "title": "Cross-emitter line",
            "test_date": "2026-09-22",
            "simulation_created_date": "2026-09-01",
            "line_results": [{"test_line_id": other_lines[0]["id"], "outcome": "pass"}],
        },
    )
    assert resp.status_code == 404


def test_create_test_record_rejects_unknown_intercepted_mode(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    lines = _import_lines(editor_client, emitter_id, ["Line A"])
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "simulation",
            "title": "Bad intercepted mode",
            "test_date": "2026-09-22",
            "simulation_created_date": "2026-09-01",
            "line_results": [
                {
                    "test_line_id": lines[0]["id"],
                    "outcome": "partial",
                    "intercepted_mode_ids": ["00000000-0000-0000-0000-000000000000"],
                }
            ],
        },
    )
    assert resp.status_code == 404


def test_mdf_scoped_test_record_rejects_line_results(editor_client, emitter_with_mode):
    mdf = editor_client.post("/mdfs", json={"name": "An MDF"}).json()
    resp = editor_client.post(
        f"/mdfs/{mdf['id']}/test-records",
        json={
            "test_type": "simulation",
            "title": "No lines on MDF scope",
            "test_date": "2026-09-22",
            "simulation_created_date": "2026-09-01",
            "line_results": [{"test_line_id": "00000000-0000-0000-0000-000000000000", "outcome": "pass"}],
        },
    )
    assert resp.status_code == 422


def test_emitter_last_validated_reflects_most_recent_line_tested_record(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    lines = _import_lines(editor_client, emitter_id, ["Line A"])

    before = editor_client.get(f"/emitters/{emitter_id}").json()
    assert before["last_validated_at"] is None
    assert before["last_validated_result"] is None

    editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "simulation",
            "title": "First sim",
            "test_date": "2026-09-01",
            "simulation_created_date": "2026-08-01",
            "line_results": [{"test_line_id": lines[0]["id"], "outcome": "fail"}],
        },
    )
    later_record = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "simulation",
            "title": "Second sim",
            "test_date": "2026-09-15",
            "simulation_created_date": "2026-08-01",
            "line_results": [{"test_line_id": lines[0]["id"], "outcome": "pass"}],
        },
    ).json()

    after = editor_client.get(f"/emitters/{emitter_id}").json()
    assert after["last_validated_at"] == "2026-09-15"
    assert after["last_validated_result"] == "pass"
    assert after["last_validated_test_record_id"] == later_record["id"]

    # A test with only mode_results (no line_results) never counts toward the
    # simulation-vs-emitter headline — it's a different, Mode-level question.
    editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "intercept",
            "title": "Mode-only test",
            "test_date": "2026-09-20",
            "mode_results": [{"mode_id": emitter_with_mode["mode"]["id"], "result": "fail"}],
        },
    )
    still_after = editor_client.get(f"/emitters/{emitter_id}").json()
    assert still_after["last_validated_at"] == "2026-09-15"
