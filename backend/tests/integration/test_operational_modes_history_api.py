"""Operational modes on an Emitter whose saved version came before them:
they show as unsaved changes, a discard takes them away, and the trail has them."""

from app.models.emitter_version import EmitterVersion


def _strip(db_session, emitter_id):
    """As a version saved before operational modes existed: no such key."""
    for v in db_session.query(EmitterVersion).filter(EmitterVersion.emitter_id == emitter_id):
        snap = dict(v.snapshot)
        snap.pop("operational_modes", None)
        for g in snap.get("ew_groups", []):
            for m in g.get("modes", []):
                m.pop("operational_mode_id", None)
        v.snapshot = snap
    db_session.commit()


def test_an_operational_mode_added_since_an_older_version_shows_and_is_discarded(editor_client, db_session):
    e = editor_client.post("/emitters", json={"name": "Old Radar"}).json()
    editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"})
    _strip(db_session, e["id"])
    editor_client.post(f"/emitters/{e['id']}/checkout")
    track = editor_client.post(f"/emitters/{e['id']}/operational-modes", json={"name": "TRACK"})
    assert track.status_code == 201, track.text

    live = editor_client.get(f"/emitters/{e['id']}/diff/live").json()
    assert any(d["scope"] == "Operational mode 'TRACK'" and d["kind"] == "added" for d in live["entries"]), live

    log = editor_client.get("/audit-log", params={"emitter_id": e["id"]}).json()
    assert "Created operational mode 'TRACK'" in [x["summary"] for x in log["items"]]

    assert editor_client.post(f"/emitters/{e['id']}/discard").status_code == 200
    assert editor_client.get(f"/emitters/{e['id']}/operational-modes").json() == []


def test_newer_fields_against_an_older_version_show_and_go_on_discard(editor_client, db_session):
    """Illumination time, a Mode's scan box and its link set since a version
    saved before them: unsaved changes, and the discard's trail says what it undid."""
    e = editor_client.post("/emitters", json={"name": "Older Radar"}).json()
    g = editor_client.post(f"/emitters/{e['id']}/ew-groups", json={"name": "G"}).json()
    s = editor_client.post(f"/emitters/{e['id']}/sources", json={"name": "S", "source_date": "2026-01-01"}).json()
    from tests.integration.test_platform_uniqueness_api import LINE

    m = editor_client.post(
        f"/ew-groups/{g['id']}/modes", json={"source_id": s["id"], "name": "M", "pri_type": "fixed", "line": {**LINE, "pri_min_us": 990, "pri_max_us": 1000}}
    ).json()
    editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"})
    _strip(db_session, e["id"])
    editor_client.post(f"/emitters/{e['id']}/checkout")
    track = editor_client.post(f"/emitters/{e['id']}/operational-modes", json={"name": "TRACK", "plan": {"rf": [{"min": 9400}]}}).json()
    editor_client.patch(f"/emitters/{e['id']}", json={"illumination_time_ms": 30})
    editor_client.patch(f"/ew-groups/{g['id']}/modes/{m['id']}", json={"scan_min_s": 1, "scan_max_s": 2, "operational_mode_id": track["id"]})

    live = editor_client.get(f"/emitters/{e['id']}/diff/live").json()["entries"]
    labels = {(d["scope"], d["label"]) for d in live}
    assert {("Emitter", "Illumination time (ms)"), ("Mode 'M'", "Scan period min (s)"), ("Mode 'M'", "Operational mode")} <= labels
    assert ("Operational mode 'TRACK'", "Added") in labels

    assert editor_client.post(f"/emitters/{e['id']}/discard").status_code == 200
    back = next(x for x in editor_client.get(f"/ew-groups/{g['id']}/modes").json() if x["id"] == m["id"])
    assert (back["scan_min_s"], back["operational_mode_id"]) == (None, None)
    assert editor_client.get(f"/emitters/{e['id']}").json()["illumination_time_ms"] is None
    summaries = [x["summary"] for x in editor_client.get("/audit-log", params={"emitter_id": e["id"], "limit": 100}).json()["items"]]
    assert any(x.startswith("Removed operational mode 'TRACK'") for x in summaries), summaries
    assert any(x.startswith("Changed Mode 'M' back") for x in summaries), summaries
