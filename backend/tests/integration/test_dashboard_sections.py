import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import event

from app.core.enums import AmbiguityRunStatus, AmbiguityScopeType, AmbiguitySeverity
from app.models.ambiguity import AmbiguityFinding, AmbiguityRun
from app.models.emitter import Emitter

MODE_LINE = {
    "rf_min_mhz": 2900, "rf_max_mhz": 3100, "pw_min_us": 0.5, "pw_max_us": 1.2,
    "pri_min_us": 800, "pri_max_us": 1200, "jitter_min_us": 5, "jitter_max_us": 15,
    "rf_delta": 0, "pw_delta": 0, "pri_delta": 0,
    "rf_range_matching": False, "pw_range_matching": False, "pri_range_matching": False,
}


def _emitter_with_mode(client, name):
    emitter = client.post("/emitters", json={"name": name}).json()
    group = client.post(
        f"/emitters/{emitter['id']}/ew-groups", json={"name": "G", "scan_min": 1, "scan_max": 2, "threat_priority": 5}
    ).json()
    source = client.post(f"/emitters/{emitter['id']}/sources", json={"name": "S", "source_date": "2025-01-15"}).json()
    client.post(f"/ew-groups/{group['id']}/modes", json={"source_id": source["id"], "name": "M1", "pri_type": "fixed", "line": MODE_LINE})
    return emitter


def _attention(client):
    return client.get("/dashboard/attention").json()["needs_attention"]


def test_sections_load_on_their_own(editor_client):
    _emitter_with_mode(editor_client, "Section Radar")
    overview = editor_client.get("/dashboard/overview").json()
    assert overview["emitter_status_counts"]["draft"] == 1 and len(overview["emitter_sim_status"]) == 1
    assert set(editor_client.get("/dashboard/test-runs").json()) == {"recent_test_runs", "needs_redo"}
    assert "needs_attention" in editor_client.get("/dashboard/attention").json()


def test_uncovered_intercept_entries_need_attention(editor_client):
    emitter = _emitter_with_mode(editor_client, "Covered Radar")
    intercept = editor_client.post("/intercepts", json={"emitter_id": emitter["id"], "name": "Night Pass"}).json()
    inside = {"pri_type": "fixed", "rf_mean_mhz": 3000, "pw_mean_us": 1.0, "pri_mean_us": 1000, "jitter_mean_us": 10}
    outside = {**inside, "rf_mean_mhz": 9000, "pw_mean_us": 5.0}
    for entry in (inside, outside, outside):
        assert editor_client.post(f"/intercepts/{intercept['id']}/entries", json=entry).status_code == 201
    [item] = [i for i in _attention(editor_client) if i["category"] == "intercepts"]
    assert item["entity_type"] == "intercept" and item["entity_id"] == intercept["id"]
    assert item["message"] == "Intercept 'Night Pass' (Covered Radar): 2 entries no Mode covers."


def test_unreviewed_serious_ambiguities_need_attention(editor_client, db_session):
    emitter = editor_client.post("/emitters", json={"name": "Ambiguous Radar"}).json()
    eid = uuid.UUID(emitter["id"])

    def run(when, severities, reviewed=False):
        r = AmbiguityRun(
            scope_type=AmbiguityScopeType.emitter, scope_id=eid, status=AmbiguityRunStatus.complete,
            tolerance_config={}, created_at=when,
        )
        db_session.add(r)
        db_session.flush()
        for sev in severities:
            db_session.add(AmbiguityFinding(
                run_id=r.id, mode_id_a=uuid.uuid4(), mode_id_b=uuid.uuid4(), rf_overlap_pct=100, pw_overlap_pct=100,
                pri_comparison_type="fixed", combined_severity=sev, details={},
                reviewed_at=datetime.now(timezone.utc) if reviewed else None,
            ))
        db_session.commit()

    now = datetime.now(timezone.utc)
    # An older run's findings don't count once a newer check exists.
    run(now - timedelta(days=2), [AmbiguitySeverity.high] * 5)
    run(now, [AmbiguitySeverity.high, AmbiguitySeverity.exact_overlap, AmbiguitySeverity.low])
    [item] = [i for i in _attention(editor_client) if i["category"] == "ambiguity"]
    assert item["message"] == "Emitter 'Ambiguous Radar': 2 serious overlaps unreviewed in its latest ambiguity check."

    # Reviewed findings drop out.
    run(now + timedelta(minutes=1), [AmbiguitySeverity.high], reviewed=True)
    assert not [i for i in _attention(editor_client) if i["category"] == "ambiguity"]


def test_long_held_locks_shown_to_others_and_admins_not_viewers(admin_client, editor_client, viewer_client, db_session):
    emitter = editor_client.post("/emitters", json={"name": "Held Radar"}).json()  # editor_t holds it
    db_session.query(Emitter).filter(Emitter.id == uuid.UUID(emitter["id"])).update(
        {"checked_out_at": datetime.now(timezone.utc) - timedelta(days=3)}
    )
    db_session.commit()
    locks = [i for i in _attention(admin_client) if i["category"] == "locks"]
    assert locks and "held for editing by editor_t for 3 days" in locks[0]["message"]
    # Not to whoever holds it (it's on their My work), nor to viewers.
    assert not [i for i in _attention(editor_client) if i["category"] == "locks"]
    assert not [i for i in _attention(viewer_client) if i["category"] == "locks"]

    admin = admin_client.get("/dashboard/admin").json()
    assert [i["entity_id"] for i in admin["long_held_locks"]] == [emitter["id"]]
    assert editor_client.get("/dashboard/admin").status_code == 403


def test_viewers_dont_get_review_queue(editor_client, viewer_client, db_session):
    from app.core.enums import SourceStatus
    from app.models.source import Source

    emitter = editor_client.post("/emitters", json={"name": "Review Radar"}).json()
    source = editor_client.post(f"/emitters/{emitter['id']}/sources", json={"name": "S", "source_date": "2025-01-15"}).json()
    db_session.query(Source).filter(Source.id == uuid.UUID(source["id"])).update({"status": SourceStatus.pending_review})
    db_session.commit()
    assert len(editor_client.get("/dashboard/attention").json()["pending_approvals"]) == 1
    assert viewer_client.get("/dashboard/attention").json()["pending_approvals"] == []


def test_recent_activity_is_quiet_unless_asked(admin_client):
    admin_client.post("/emitters", json={"name": "Quiet Radar"})
    quiet = admin_client.get("/dashboard/activity").json()["recent_activity"]
    everything = admin_client.get("/dashboard/activity", params={"everything": True}).json()["recent_activity"]
    assert not any(a["action"] in ("login", "checkout") for a in quiet)
    assert any(a["action"] == "login" for a in everything)


def test_failed_logins_for_admins(admin_client, client):
    client.post("/auth/login", json={"username": "admin_t", "password": "wrong-password"})
    admin = admin_client.get("/dashboard/admin").json()
    assert admin["failed_logins_24h"] >= 1 and admin["recent_failed_logins"]


def test_attention_query_count_doesnt_grow_with_drafts_and_mdfs(editor_client, db_session):
    bind = db_session.get_bind()

    def count_queries():
        n = 0

        def before(*_):
            nonlocal n
            n += 1

        event.listen(bind, "before_cursor_execute", before)
        try:
            editor_client.get("/dashboard/attention")
        finally:
            event.remove(bind, "before_cursor_execute", before)
        return n

    def add(k):
        for i in range(k):
            editor_client.post("/emitters", json={"name": f"Draft {k}-{i}"})
            editor_client.post("/mdfs", json={"name": f"MDF {k}-{i}"})

    add(2)
    few = count_queries()
    add(8)
    many = count_queries()
    assert few > 10, few  # the listener is really counting
    assert many <= few + 2, (few, many)
