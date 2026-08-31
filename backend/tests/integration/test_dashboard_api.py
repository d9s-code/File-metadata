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
    v1 = editor_client.post(f"/emitters/{emitter['id']}/versions", json={}).json()
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
}


def test_dashboard_flags_needs_rework_emitter(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Dash Rework Emitter"}).json()
    eid = emitter["id"]
    editor_client.post(f"/emitters/{eid}/status", json={"new_status": "in_review"})
    editor_client.post(f"/emitters/{eid}/status", json={"new_status": "validated"})

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


def test_dashboard_lists_pending_source_and_mode_draft(editor_client, db_session):
    from app.core.enums import SourceStatus
    from app.models.source import Source

    emitter = editor_client.post("/emitters", json={"name": "Dash Pending Emitter"}).json()
    ew_group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Group P"}).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Source P", "source_date": "2025-01-01"}
    ).json()
    mode = editor_client.post(
        f"/ew-groups/{ew_group['id']}/modes",
        json={"source_id": source["id"], "name": "Mode P", "pri_type": "fixed", "line": FIXED_LINE},
    ).json()
    draft_resp = editor_client.post(
        f"/ew-groups/{ew_group['id']}/modes/{mode['id']}/draft",
        json={"pri_type": "fixed", "line": FIXED_LINE},
    )
    assert draft_resp.status_code == 201, draft_resp.text

    # No HTTP path creates a pending_review Source directly (only the import
    # pipeline does) — flip it via the shared session, same as the request
    # handlers would see it.
    db_session.query(Source).filter(Source.id == source["id"]).update({"status": SourceStatus.pending_review})
    db_session.commit()

    items = editor_client.get("/dashboard").json()["pending_approvals"]
    kinds = {(item["kind"], item["emitter_id"]) for item in items}
    assert ("source", emitter["id"]) in kinds
    assert ("mode", emitter["id"]) in kinds


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
            "test_type": "lab_bench",
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
            "test_type": "lab_bench",
            "title": "Retest",
            "test_date": "2026-01-02",
            "mode_results": [{"mode_id": mode["id"], "result": "pass"}],
            "retests_test_record_id": failed["id"],
        },
    )

    ids_after = {item["test_record_id"] for item in editor_client.get("/dashboard").json()["needs_redo"]}
    assert failed["id"] not in ids_after


def test_dashboard_activity_trend_has_fixed_window(editor_client):
    editor_client.post("/emitters", json={"name": "Dash Trend Emitter"})
    trend = editor_client.get("/dashboard").json()["activity_trend"]
    assert len(trend) == 21
    assert sum(p["count"] for p in trend) >= 1


def test_dashboard_recent_activity_is_populated(editor_client):
    editor_client.post("/emitters", json={"name": "Dash Activity Emitter"})
    resp = editor_client.get("/dashboard")
    assert len(resp.json()["recent_activity"]) >= 1
