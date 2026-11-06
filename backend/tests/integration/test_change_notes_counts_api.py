"""What counts in change notes: an admin setting, audited, that the summary
uses — and that the summary can preview other rules for."""

from tests.integration.test_emitter_report_api import FIXED
from tests.integration.test_mdf_plan_api import _save, _setup


def _new_track_mode(client, emitter, platform, mdf):
    group = client.get(f"/emitters/{emitter[0]['id']}/ew-groups").json()[0]
    source = client.get(f"/emitters/{emitter[0]['id']}/sources").json()[0]
    client.post(f"/ew-groups/{group['id']}/modes", json={"source_id": source["id"], "name": "Track", "pri_type": "fixed", "line": FIXED})
    ev2 = _save(client, "emitters", emitter[0]["id"])
    client.post(f"/platforms/{platform['id']}/links", json={"emitter_id": emitter[0]["id"], "emitter_version_id": ev2["id"]})
    pv = _save(client, "platforms", platform["id"])
    client.post(f"/mdfs/{mdf['id']}/links", json={"platform_id": platform["id"], "platform_version_id": pv["id"]})
    _save(client, "mdfs", mdf["id"], "Track mode")


def test_the_setting_is_audited_and_used_by_the_summary(admin_client, editor_client):
    counts = editor_client.get("/settings").json()["change_notes_counts"]
    assert counts["modes"] and counts["deltas"] and not counts["confirmation"]
    assert editor_client.patch("/settings", json={"change_notes_counts": {"modes": False}}).status_code == 403
    assert admin_client.patch("/settings", json={"change_notes_counts": {"bogus": True}}).status_code == 422

    emitter, platform, mdf = _setup(editor_client, "Counts MDF")
    _new_track_mode(editor_client, emitter, platform, mdf)
    summary = lambda **p: editor_client.get(f"/mdfs/{mdf['id']}/summary", params={"from_version": 1, **p})  # noqa: E731
    assert summary().json()["change_notes"]["updated"][0]["items"] == ["1 Mode added: Track"]

    # A preview: the rules that are on, the saved setting untouched.
    preview = summary(counts="platforms,emitters").json()["change_notes"]
    assert preview == {"added": [], "removed": [], "updated": []}
    assert summary(counts="modes,nonsense").status_code == 422

    resp = admin_client.patch("/settings", json={"change_notes_counts": {"modes": False, "confirmation": True}})
    assert resp.status_code == 200, resp.text
    assert resp.json()["change_notes_counts"] == {**counts, "modes": False, "confirmation": True}
    assert summary().json()["change_notes"]["updated"] == []
    log = admin_client.get("/audit-log", params={"limit": 20}).json()
    summaries = [e["summary"] for e in (log["items"] if isinstance(log, dict) else log)]
    assert "Changed what counts in change notes: Modes added/removed off, confirmation on" in summaries
