def test_dashboard_counts_reflect_created_entities(editor_client):
    editor_client.post("/emitters", json={"name": "Dash Emitter 1"})
    editor_client.post("/emitters", json={"name": "Dash Emitter 2"})
    editor_client.post("/mdfs", json={"name": "Dash MDF 1"})

    resp = editor_client.get("/dashboard")
    assert resp.status_code == 200
    body = resp.json()
    assert body["emitter_status_counts"]["draft"] >= 2
    assert body["mdf_status_counts"]["draft"] >= 1


def test_dashboard_flags_mdf_needing_attention(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Dash Attn Emitter"}).json()
    v1 = editor_client.post(f"/emitters/{emitter['id']}/versions", json={"change_summary": "test"}).json()
    platform = editor_client.post("/platforms", json={"name": "Dash Attn Platform"}).json()
    editor_client.post(
        f"/platforms/{platform['id']}/links", json={"emitter_id": emitter["id"], "emitter_version_id": v1["id"]}
    )
    platform_v1 = editor_client.post(f"/platforms/{platform['id']}/versions", json={}).json()
    mdf = editor_client.post("/mdfs", json={"name": "Dash Attn MDF"}).json()
    editor_client.post(
        f"/mdfs/{mdf['id']}/links", json={"platform_id": platform["id"], "platform_version_id": platform_v1["id"]}
    )

    resp = editor_client.get("/dashboard")
    items = resp.json()["needs_attention"]
    assert any(
        item["entity_type"] == "mdf" and item["entity_id"] == mdf["id"] and "Dash Attn MDF" in item["message"]
        for item in items
    )


def test_viewer_can_read_dashboard(viewer_client):
    resp = viewer_client.get("/dashboard")
    assert resp.status_code == 200


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


def test_dashboard_flags_needs_rework_emitter(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Dash Rework Emitter"}).json()
    eid = emitter["id"]
    editor_client.post(f"/emitters/{eid}/status", json={"new_status": "in_review"})
    editor_client.post(f"/emitters/{eid}/status", json={"new_status": "validated", "note": "Looks good."})

    no_note = editor_client.post(f"/emitters/{eid}/status", json={"new_status": "deprecated"})
    assert no_note.status_code == 422

    resp = editor_client.post(
        f"/emitters/{eid}/status", json={"new_status": "deprecated", "note": "RF drifted, recheck."}
    )
    assert resp.status_code == 200, resp.text

    dash = editor_client.get("/dashboard").json()
    matches = [i for i in dash["needs_attention"] if i["entity_id"] == eid]
    assert len(matches) == 1
    assert "RF drifted, recheck." in matches[0]["message"]


def test_dashboard_lists_pending_source(editor_client, db_session):
    from app.core.enums import SourceStatus
    from app.models.source import Source

    emitter = editor_client.post("/emitters", json={"name": "Dash Pending Emitter"}).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Source P", "source_date": "2025-01-01"}
    ).json()

    # No HTTP path creates a pending_review Source directly (only the import
    # pipeline does) — flip it via the shared session, same as the request
    # handlers would see it.
    db_session.query(Source).filter(Source.id == source["id"]).update({"status": SourceStatus.pending_review})
    db_session.commit()

    items = editor_client.get("/dashboard").json()["pending_approvals"]
    kinds = {(item["kind"], item["emitter_id"]) for item in items}
    assert ("source", emitter["id"]) in kinds


def test_dashboard_needs_redo_appears_then_disappears_after_retest(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Dash Redo Emitter"}).json()
    ew_group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Group R"}).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Source R", "source_date": "2025-01-01"}
    ).json()
    mode = editor_client.post(
        f"/ew-groups/{ew_group['id']}/modes",
        json={"source_id": source["id"], "name": "Mode R", "pri_type": "fixed", "line": FIXED_LINE},
    ).json()
    failed = editor_client.post(
        f"/emitters/{emitter['id']}/test-records",
        json={
            "test_type": "intercept",
            "title": "Failing run",
            "test_date": "2026-01-01",
            "mode_results": [{"mode_id": mode["id"], "result": "fail"}],
        },
    ).json()

    ids = {item["test_record_id"] for item in editor_client.get("/dashboard").json()["needs_redo"]}
    assert failed["id"] in ids

    editor_client.post(
        f"/emitters/{emitter['id']}/test-records",
        json={
            "test_type": "intercept",
            "title": "Retest",
            "test_date": "2026-01-02",
            "mode_results": [{"mode_id": mode["id"], "result": "pass"}],
            "retests_test_record_id": failed["id"],
        },
    )

    ids_after = {item["test_record_id"] for item in editor_client.get("/dashboard").json()["needs_redo"]}
    assert failed["id"] not in ids_after


def test_dashboard_recent_activity_is_populated(editor_client):
    editor_client.post("/emitters", json={"name": "Dash Activity Emitter"})
    resp = editor_client.get("/dashboard")
    assert len(resp.json()["recent_activity"]) >= 1


def _sim_emitter(client, name, line_count=3):
    emitter = client.post("/emitters", json={"name": name}).json()
    lines = client.post(
        f"/emitters/{emitter['id']}/test-lines/import",
        json={"created_date": "2026-08-01", "lines": [{"label": f"SIM {i}"} for i in range(line_count)]},
    ).json()
    return emitter, lines


def _sim_run(client, emitter_id, outcomes, test_date="2026-09-01"):
    return client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "simulation",
            "title": f"Run {test_date}",
            "test_date": test_date,
            "simulation_created_date": "2026-08-01",
            "line_results": [{"test_line_id": line_id, "outcome": o} for line_id, o in outcomes],
        },
    )


def _row(body, emitter_id):
    return next(r for r in body["emitter_sim_status"] if r["emitter_id"] == emitter_id)


def test_dashboard_reports_each_emitters_sim_line_outcomes(editor_client):
    emitter, lines = _sim_emitter(editor_client, "Dash Sim Emitter")
    body = editor_client.get("/dashboard").json()
    assert _row(body, emitter["id"])["line_outcomes"]["untested"] == 3
    assert _row(body, emitter["id"])["last_validated_at"] is None

    assert _sim_run(editor_client, emitter["id"], [(lines[0]["id"], "pass"), (lines[1]["id"], "fail")]).status_code == 201
    body = editor_client.get("/dashboard").json()
    row = _row(body, emitter["id"])
    assert row["line_count"] == 3
    assert (row["line_outcomes"]["pass"], row["line_outcomes"]["fail"], row["line_outcomes"]["untested"]) == (1, 1, 1)
    assert row["last_validated_at"] == "2026-09-01"
    # System-wide totals include this Emitter's lines.
    assert body["sim_line_counts"]["fail"] >= 1

    # Only each line's latest run counts.
    _sim_run(editor_client, emitter["id"], [(lines[1]["id"], "pass")], test_date="2026-09-05")
    row = _row(editor_client.get("/dashboard").json(), emitter["id"])
    assert (row["line_outcomes"]["pass"], row["line_outcomes"]["fail"]) == (2, 0)


def test_dashboard_flags_missed_lines_and_unvalidated_testing_emitters(editor_client):
    emitter, lines = _sim_emitter(editor_client, "Dash Missed Emitter")
    editor_client.post(f"/emitters/{emitter['id']}/versions", json={"change_summary": "v1"})
    editor_client.post(f"/emitters/{emitter['id']}/status", json={"new_status": "in_review"})

    messages = [i["message"] for i in editor_client.get("/dashboard").json()["needs_attention"]]
    assert "Emitter 'Dash Missed Emitter' is in Testing but hasn't been checked against a simulation yet." in messages

    _sim_run(editor_client, emitter["id"], [(lines[0]["id"], "fail"), (lines[1]["id"], "partial")])
    items = [i for i in editor_client.get("/dashboard").json()["needs_attention"] if i["entity_id"] == emitter["id"]]
    assert [i["message"] for i in items] == [
        "Emitter 'Dash Missed Emitter': 2 SIM Test Lines were missed or misclassified in the latest run."
    ]
    assert items[0]["category"] == "sim"


def test_dashboard_flags_emitter_changed_after_its_last_simulation_test(editor_client):
    emitter, lines = _sim_emitter(editor_client, "Dash Changed Emitter", line_count=1)
    editor_client.post(f"/emitters/{emitter['id']}/versions", json={"change_summary": "v1"})
    editor_client.post(f"/emitters/{emitter['id']}/status", json={"new_status": "in_review"})
    _sim_run(editor_client, emitter["id"], [(lines[0]["id"], "pass")], test_date="2020-01-01")

    # Only the status change was committed since — not a content change yet.
    assert _row(editor_client.get("/dashboard").json(), emitter["id"])["changed_since_validation"] is False

    editor_client.patch(f"/emitters/{emitter['id']}", json={"description": "tweaked"})
    editor_client.post(f"/emitters/{emitter['id']}/versions", json={"change_summary": "v2"})
    body = editor_client.get("/dashboard").json()
    assert _row(body, emitter["id"])["changed_since_validation"] is True
    assert "Emitter 'Dash Changed Emitter' was changed after its last simulation test (2020-01-01)." in [
        i["message"] for i in body["needs_attention"]
    ]


def test_dashboard_lists_recent_test_runs_with_line_outcomes(editor_client):
    emitter, lines = _sim_emitter(editor_client, "Dash Runs Emitter", line_count=2)
    run = _sim_run(editor_client, emitter["id"], [(lines[0]["id"], "pass"), (lines[1]["id"], "fail")], test_date="2099-01-01").json()
    [latest] = [r for r in editor_client.get("/dashboard").json()["recent_test_runs"] if r["test_record_id"] == run["id"]]
    assert latest["entity_name"] == "Dash Runs Emitter"
    assert latest["test_type"] == "simulation"
    assert (latest["line_outcomes"]["pass"], latest["line_outcomes"]["fail"]) == (1, 1)
