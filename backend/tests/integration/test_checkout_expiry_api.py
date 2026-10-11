"""Edit locks nobody has used are flagged, then released."""

from datetime import datetime, timedelta, timezone

from app.models.audit_log import AuditLog
from app.models.emitter import Emitter


def _held(client, db_session, name, days_ago, touched_days_ago=None):
    e = client.post("/emitters", json={"name": name}).json()
    client.post(f"/emitters/{e['id']}/checkout")
    row = db_session.get(Emitter, e["id"])
    row.checked_out_at = datetime.now(timezone.utc) - timedelta(days=days_ago)
    # Nothing the holder did since, unless said otherwise.
    db_session.query(AuditLog).filter(AuditLog.emitter_id == row.id).update(
        {AuditLog.created_at: row.checked_out_at - timedelta(minutes=1)}
    )
    if touched_days_ago is not None:
        last = db_session.query(AuditLog).filter(AuditLog.emitter_id == row.id).first()
        last.created_at = datetime.now(timezone.utc) - timedelta(days=touched_days_ago)
    db_session.commit()
    return e


def test_stale_locks_are_flagged_then_released(editor_client, db_session):
    old = _held(editor_client, db_session, "Expiry Old", days_ago=20)
    stale = _held(editor_client, db_session, "Expiry Stale", days_ago=5)
    busy = _held(editor_client, db_session, "Expiry Busy", days_ago=20, touched_days_ago=1)

    locks = {c["emitter_name"]: c for c in editor_client.get("/emitters/checkouts").json()}
    assert "Expiry Old" not in locks  # untouched for 20 days: released
    assert locks["Expiry Stale"]["stale"] is True
    assert locks["Expiry Stale"]["releases_at"] is not None
    assert locks["Expiry Busy"]["stale"] is False  # the holder changed it yesterday

    assert editor_client.get(f"/emitters/{old['id']}").json()["checked_out_by_id"] is None
    entries = editor_client.get("/audit-log", params={"emitter_id": old["id"]}).json()
    items = entries["items"] if isinstance(entries, dict) else entries
    assert any("automatically" in e["summary"] for e in items)
    assert editor_client.get(f"/emitters/{stale['id']}").json()["checked_out_by_id"] is not None
    assert editor_client.get(f"/emitters/{busy['id']}").json()["checked_out_by_id"] is not None
