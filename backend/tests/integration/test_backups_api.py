import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError

from app.config import settings
from app.services import backup_service

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
def backup_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "backup_dir", str(tmp_path / "backups"))
    monkeypatch.setattr(settings, "backup_copy_dir", None)
    return tmp_path / "backups"


def _verify_db_available() -> bool:
    try:
        with create_engine(backup_service.verify_database_url()).connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except OperationalError:
        return False


def _emitter_with_mode(client, name="Backup Radar"):
    emitter = client.post("/emitters", json={"name": name}).json()
    group = client.post(
        f"/emitters/{emitter['id']}/ew-groups",
        json={"name": "G", "scan_min": 1.0, "scan_max": 2.0, "threat_priority": 5},
    ).json()
    source = client.post(f"/emitters/{emitter['id']}/sources", json={"name": "S", "source_date": "2025-01-15"}).json()
    client.post(
        f"/ew-groups/{group['id']}/modes",
        json={"source_id": source["id"], "name": "M1", "pri_type": "fixed", "line": FIXED_LINE},
    )
    client.post(f"/emitters/{emitter['id']}/versions", json={"change_summary": "v1"})
    return emitter, group, source


def test_backup_writes_a_dump_with_a_matching_overview(admin_client, backup_dir):
    emitter, _, _ = _emitter_with_mode(admin_client)
    versions = admin_client.get(f"/emitters/{emitter['id']}/versions").json()
    platform = admin_client.post("/platforms", json={"name": "Backup Platform"}).json()
    admin_client.post(
        f"/platforms/{platform['id']}/links", json={"emitter_id": emitter["id"], "emitter_version_id": versions[-1]["id"]}
    )

    resp = admin_client.post("/admin/backups")
    assert resp.status_code == 201, resp.text
    item = resp.json()
    assert item["kind"] == "manual" and item["created_by"] == "admin_t"
    assert item["summary"] == {"emitters": 1, "platforms": 1, "mdfs": 0}

    dump = backup_dir / item["file"]
    assert dump.exists() and dump.stat().st_size > 0
    manifest = backup_service.read_manifest(dump)
    assert manifest["sha256"] and manifest["counts"]["emitters"] == 1 and manifest["counts"]["modes"] == 1
    [e] = manifest["overview"]["emitters"]
    assert (e["name"], e["modes"], e["version"], e["deleted"]) == ("Backup Radar", 1, 1, False)
    [p] = manifest["overview"]["platforms"]
    assert p["pins"] == [{"id": emitter["id"], "name": "Backup Radar", "version": 1}]

    listing = admin_client.get("/admin/backups").json()
    assert [b["file"] for b in listing["backups"]] == [item["file"]]
    assert listing["live"] == {"emitters": 1, "platforms": 1, "mdfs": 0}


def test_diff_between_backups_and_against_live_data(admin_client, backup_dir):
    emitter, group, source = _emitter_with_mode(admin_client, name="Before")
    first = admin_client.post("/admin/backups").json()["file"]

    admin_client.patch(f"/emitters/{emitter['id']}", json={"name": "After"})
    admin_client.post(
        f"/ew-groups/{group['id']}/modes",
        json={"source_id": source["id"], "name": "M2", "pri_type": "fixed", "line": FIXED_LINE},
    )
    admin_client.post(f"/emitters/{emitter['id']}/versions", json={"change_summary": "v2"})
    admin_client.post("/platforms", json={"name": "New Platform"})
    # Backup filenames are to the second.
    import time

    time.sleep(1.1)
    second = admin_client.post("/admin/backups").json()["file"]

    diff = admin_client.get("/admin/backups/diff", params={"from": first, "to": second}).json()
    [changed] = diff["changes"]["emitters"]["changed"]
    assert changed["name"] == "After"
    assert changed["changes"] == ["Renamed from Before", "Modes: 1 → 2", "Saved version: v1 → v2"]
    assert [p["name"] for p in diff["changes"]["platforms"]["added"]] == ["New Platform"]
    assert diff["changes"]["mdfs"] == {"added": [], "removed": [], "changed": [], "unchanged": 0}

    # Against the live data: a delete since the second backup shows as moved to the trash.
    admin_client.delete(f"/emitters/{emitter['id']}")
    live = admin_client.get("/admin/backups/diff", params={"from": second}).json()
    assert live["to"]["label"] == "Current data"
    assert live["changes"]["emitters"]["changed"][0]["changes"] == ["Moved to Recently Deleted"]

    assert admin_client.get("/admin/backups/diff", params={"from": "../etc/passwd"}).status_code == 404


def test_diff_lines_cover_status_pins_and_removals():
    old = {
        "emitters": [{"id": "e1", "name": "A", "designation": None, "status": "draft", "deleted": False, "modes": 3, "version": None}],
        "platforms": [{"id": "p1", "name": "P", "deleted": False, "version": 1, "pins": [{"id": "e1", "name": "A", "version": 1}]}],
        "mdfs": [{"id": "m1", "name": "M", "status": "draft", "deleted": False, "version": 1, "pins": []}],
    }
    new = {
        "emitters": [{"id": "e1", "name": "A", "designation": "X-1", "status": "in_review", "deleted": False, "modes": 3, "version": 1}],
        "platforms": [{"id": "p1", "name": "P", "deleted": False, "version": 2, "pins": [{"id": "e1", "name": "A", "version": 2}]}],
        "mdfs": [],
    }
    diff = backup_service.diff_overviews(old, new)
    assert diff["emitters"]["changed"][0]["changes"] == [
        "Designation: — → X-1",
        "Status: In progress → Testing",
        "First saved as v1",
    ]
    assert diff["platforms"]["changed"][0]["changes"] == ["Saved version: v1 → v2", "A pin: v1 → v2"]
    assert diff["mdfs"]["removed"] == [{"id": "m1", "name": "M"}]


def test_verify_restores_and_catches_a_changed_file(admin_client, backup_dir):
    if not _verify_db_available():
        pytest.skip(f"No verification database ({backup_service.db_name(backup_service.verify_database_url())}) on this server")
    _emitter_with_mode(admin_client)
    name = admin_client.post("/admin/backups").json()["file"]

    resp = admin_client.post(f"/admin/backups/{name}/verify")
    assert resp.status_code == 200, resp.text
    check = resp.json()["verification"]
    assert check["ok"], check
    assert check["tables"] > 10

    # The scratch database is emptied again afterwards.
    with create_engine(backup_service.verify_database_url()).connect() as conn:
        left = conn.execute(text("SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')")).scalar()
    assert left == 0

    # A file changed after it was written fails, and admins are told.
    with open(backup_dir / name, "ab") as f:
        f.write(b"tampered")
    check = admin_client.post(f"/admin/backups/{name}/verify").json()["verification"]
    assert not check["ok"] and "checksum" in check["message"]
    health = admin_client.get("/admin/backups/health").json()
    assert not health["ok"] and any("verification failed" in p for p in health["problems"])


def test_prune_keeps_the_policy_and_removes_manifests(tmp_path):
    for day in range(1, 31):
        dump = tmp_path / f"emitterdb_202601{day:02d}_030000.dump"
        dump.write_bytes(b"x")
        backup_service.write_manifest(dump, {"file": dump.name})
    removed = backup_service.prune_backups(tmp_path, keep_daily=7, keep_weekly=2, keep_monthly=1)
    left = sorted(p.name for p in tmp_path.glob("*.dump"))
    assert len(left) == 30 - len(removed) and len(left) <= 10
    assert "emitterdb_20260130_030000.dump" in left
    assert not any((tmp_path / p.name).with_suffix(".json").exists() for p in removed)


def test_backups_are_admin_only(editor_client, backup_dir):
    assert editor_client.get("/admin/backups").status_code == 403
    assert editor_client.post("/admin/backups").status_code == 403


def test_health_says_what_is_missing(admin_client, backup_dir):
    health = admin_client.get("/admin/backups/health").json()
    assert not health["ok"]
    assert "No backups have been taken yet" in health["problems"]
    assert any("scheduler hasn't reported" in p for p in health["problems"])
    assert os.environ.get("DATABASE_URL")  # sanity: running against the test database


def test_health_endpoint_checks_the_database(client, monkeypatch):
    assert client.get("/health").json() == {"status": "ok", "database": "ok"}

    import app.main

    monkeypatch.setattr(app.main, "engine", create_engine("postgresql+psycopg2://nobody:x@127.0.0.1:1/none"))
    resp = client.get("/health")
    assert resp.status_code == 503 and resp.json()["database"] == "unreachable"


def test_unchanged_leaves_out_items_in_recently_deleted():
    item = {"id": "e1", "name": "A", "designation": None, "status": "draft", "deleted": True, "modes": 0, "version": None}
    live = {**item, "id": "e2", "deleted": False}
    overview = {"emitters": [item, live], "platforms": [], "mdfs": []}
    assert backup_service.diff_overviews(overview, overview)["emitters"]["unchanged"] == 1


def test_download_returns_the_file_and_is_audited(admin_client, editor_client, backup_dir, db_session):
    from app.models.audit_log import AuditLog

    name = admin_client.post("/admin/backups").json()["file"]
    resp = admin_client.get(f"/admin/backups/{name}/download")
    assert resp.status_code == 200
    assert resp.content == (backup_dir / name).read_bytes()
    assert name in resp.headers["content-disposition"]

    summaries = [a.summary for a in db_session.query(AuditLog).filter(AuditLog.entity_type == "backup")]
    assert f"Took backup {name}" in summaries and f"Downloaded backup {name}" in summaries

    assert editor_client.get(f"/admin/backups/{name}/download").status_code == 403
    assert admin_client.get("/admin/backups/emitterdb_20000101_000000.dump/download").status_code == 404
    assert admin_client.get("/admin/backups/..%2Fsecret/download").status_code == 404


def test_freshness_counts_changes_and_scales_the_alert(admin_client, viewer_client, backup_dir, monkeypatch):
    from datetime import datetime, timedelta, timezone

    assert viewer_client.get("/backup-status").json()["level"] == "none"

    admin_client.post("/emitters", json={"name": "Fresh A"})
    name = admin_client.post("/admin/backups").json()["file"]
    admin_client.get(f"/admin/backups/{name}/download")  # not a change
    status = viewer_client.get("/backup-status").json()
    assert (status["level"], status["changes"], status["due_at"]) == ("ok", 0, None)
    assert status["kinds"]["emitters"] == {"added": 0, "removed": 0, "changed": 0, "named": []}

    # Edits are changes.
    emitter = admin_client.post("/emitters", json={"name": "Fresh B"}).json()
    admin_client.patch(f"/emitters/{emitter['id']}", json={"designation": "FB-1"})
    status = viewer_client.get("/backup-status").json()
    assert status["changes"] >= 2
    assert status["kinds"]["emitters"]["added"] == 1
    assert status["kinds"]["emitters"]["named"] == [{"id": emitter["id"], "name": "Fresh B", "how": "added"}]

    # With a week's worth of changes it's due a week on; twice as many, half that.
    monkeypatch.setattr(settings, "backup_changes_per_week", status["changes"])
    assert backup_service.due_after_hours(status["changes"]) == 168
    assert backup_service.due_after_hours(status["changes"] * 2) == 84
    later = datetime.now(timezone.utc) + timedelta(days=8)
    assert backup_service.backup_freshness(now=later)["level"] == "due"
    assert backup_service.backup_freshness(now=later + timedelta(days=7))["level"] == "overdue"
    # Admins are told, once it's due.
    def told(when):
        return [p for p in backup_service.backup_health(now=when)["problems"] if "changes have been made since" in p]

    assert told(datetime.now(timezone.utc)) == []
    assert told(later)[0].startswith("A backup is due: the latest is 8 days old")
    assert told(later + timedelta(days=7))[0].startswith("A backup is overdue")


def test_due_time_is_bounded():
    assert backup_service.due_after_hours(0) is None
    assert backup_service.due_after_hours(1) == backup_service.MAX_DUE_HOURS
    assert backup_service.due_after_hours(10**6) == backup_service.MIN_DUE_HOURS


def test_schedule_weekly_or_daily(monkeypatch):
    from datetime import datetime, timezone

    sat_evening = datetime(2026, 10, 3, 20, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(settings, "backup_schedule_time", "03:00")
    monkeypatch.setattr(settings, "backup_schedule_day", "sun")
    assert backup_service.next_scheduled_backup(sat_evening) == datetime(2026, 10, 4, 3, 0, tzinfo=timezone.utc)
    assert backup_service.next_scheduled_backup(datetime(2026, 10, 4, 3, 0, tzinfo=timezone.utc)).day == 11
    assert backup_service.schedule_label() == "Sundays at 03:00 UTC"
    monkeypatch.setattr(settings, "backup_schedule_day", "Wednesday")
    assert backup_service.next_scheduled_backup(sat_evening).day == 7
    monkeypatch.setattr(settings, "backup_schedule_day", "daily")
    assert backup_service.schedule_label() == "Every day at 03:00 UTC"
    monkeypatch.setattr(settings, "backup_schedule_day", "someday")
    with pytest.raises(ValueError):
        backup_service.schedule_weekday()


def _fake_pg_restore(tmp_path, monkeypatch, extra_stderr: str):
    """A pg_restore that really restores, then reports what a newer pg_restore says
    to an older server — the way the image's tools meet a pre-17 Postgres."""
    import shutil
    import stat

    real = shutil.which("pg_restore")
    bindir = tmp_path / "bin"
    bindir.mkdir()
    fake = bindir / "pg_restore"
    fake.write_text(f'#!/bin/sh\n[ "$1" = "--version" ] && exec {real} "$@"\n{real} "$@"\ncat >&2 <<"MSG"\n{extra_stderr}\nMSG\nexit 1\n')
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PATH", f"{bindir}:{os.environ['PATH']}")


def test_verify_skips_settings_an_older_server_doesnt_know(admin_client, backup_dir, tmp_path, monkeypatch):
    if not _verify_db_available():
        pytest.skip("No verification database on this server")
    _emitter_with_mode(admin_client)
    name = admin_client.post("/admin/backups").json()["file"]
    _fake_pg_restore(
        tmp_path,
        monkeypatch,
        'pg_restore: error: could not execute query: ERROR:  unrecognized configuration parameter "transaction_timeout"\n'
        "Command was: SET transaction_timeout = 0;\n"
        "pg_restore: warning: errors ignored on restore: 1",
    )
    check = admin_client.post(f"/admin/backups/{name}/verify").json()["verification"]
    assert check["ok"], check


def test_verify_reports_the_real_error(admin_client, backup_dir, tmp_path, monkeypatch):
    if not _verify_db_available():
        pytest.skip("No verification database on this server")
    _emitter_with_mode(admin_client)
    name = admin_client.post("/admin/backups").json()["file"]
    _fake_pg_restore(
        tmp_path,
        monkeypatch,
        'pg_restore: error: could not execute query: ERROR:  permission denied for schema public\n'
        "Command was: CREATE TABLE public.x ();",
    )
    check = admin_client.post(f"/admin/backups/{name}/verify").json()["verification"]
    assert not check["ok"]
    assert check["message"].startswith("Restore failed: permission denied for schema public"), check["message"]
