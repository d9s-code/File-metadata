"""An MDF's plan and history: due date, goals, the progress log, release
notes, the pins not saved yet, no outdated warnings once released, the
timeline and the summary between two versions (and its Word document)."""

import io
import zipfile

from tests.integration.test_emitter_report_api import FIXED, _emitter, _platform


def _move(client, mdf_id, *statuses):
    for s in statuses:
        r = client.post(f"/mdfs/{mdf_id}/status", json={"new_status": s, "confirm_unmet": True})
        assert r.status_code == 200, r.text


def _save(client, kind, item_id, summary="v"):
    r = client.post(f"/{kind}/{item_id}/versions", json={"change_summary": summary})
    assert r.status_code == 201, r.text
    return r.json()


def _setup(client, name="Plan MDF"):
    """An MDF pinning one Platform that pins one Emitter, saved as v1."""
    emitter = _emitter(client, f"{name} Radar", None, [("Search", "fixed", FIXED)])
    platform = _platform(client, f"{name} Ship", emitter)
    pv = _save(client, "platforms", platform["id"])
    mdf = client.post("/mdfs", json={"name": name, "due_date": "2027-03-01"}).json()
    assert client.post(f"/mdfs/{mdf['id']}/links", json={"platform_id": platform["id"], "platform_version_id": pv["id"]}).status_code == 201
    _save(client, "mdfs", mdf["id"], "First cut")
    return emitter, platform, mdf


def test_goals_are_set_reached_and_counted(editor_client):
    _e, _p, mdf = _setup(editor_client)
    url = f"/mdfs/{mdf['id']}/goals"
    assert editor_client.get(f"/mdfs/{mdf['id']}").json()["due_date"] == "2027-03-01"
    a = editor_client.post(url, json={"text": "All Emitters Operational"}).json()
    b = editor_client.post(url, json={"text": "Customer sign-off"}).json()
    reached = editor_client.patch(f"{url}/{a['id']}", json={"done": True, "note": "Checked 12 Nov"}).json()
    assert reached["done_at"] and reached["done_note"] == "Checked 12 Nov" and reached["done_by_username"]
    listed = next(m for m in editor_client.get("/mdfs").json() if m["id"] == mdf["id"])
    assert (listed["goals_total"], listed["goals_done"]) == (2, 1)

    assert editor_client.put(f"{url}/order", json={"ids": [b["id"], a["id"]]}).status_code == 200
    assert [g["text"] for g in editor_client.get(url).json()] == ["Customer sign-off", "All Emitters Operational"]
    assert editor_client.put(f"{url}/order", json={"ids": [b["id"]]}).status_code == 409
    reopened = editor_client.patch(f"{url}/{a['id']}", json={"done": False, "note": "A new Emitter came in"}).json()
    assert reopened["done_at"] is None
    assert editor_client.delete(f"{url}/{b['id']}").status_code == 204

    audit = [x["summary"] for x in editor_client.get("/audit-log", params={"entity_id": mdf["id"]}).json()["items"]]
    assert any("Goal reached: All Emitters Operational — Checked 12 Nov" in s for s in audit)
    assert any("Goal reopened: All Emitters Operational — A new Emitter came in" in s for s in audit)
    assert any("Goal removed: Customer sign-off" in s for s in audit)


def test_the_log_is_added_to_and_only_its_author_or_an_admin_deletes(editor_client, viewer_client, admin_client):
    _e, _p, mdf = _setup(editor_client)
    url = f"/mdfs/{mdf['id']}/log"
    mine = editor_client.post(url, json={"kind": "progress", "body": "Waiting on the Escort's radar"}).json()
    rel = editor_client.post(url, json={"kind": "release", "body": "Sent to the customer"}).json()
    assert [e["kind"] for e in viewer_client.get(url).json()] == ["release", "progress"]
    assert viewer_client.post(url, json={"body": "no"}).status_code == 403
    assert viewer_client.delete(f"{url}/{mine['id']}").status_code == 403
    other = admin_client.post(url, json={"body": "Admin's entry"}).json()
    assert editor_client.delete(f"{url}/{other['id']}").status_code == 403
    assert editor_client.delete(f"{url}/{mine['id']}").status_code == 204
    assert admin_client.delete(f"{url}/{rel['id']}").status_code == 204
    assert editor_client.post(url, json={"kind": "other", "body": "x"}).status_code == 422


def test_pins_not_yet_saved_are_listed(editor_client):
    emitter, platform, mdf = _setup(editor_client)
    assert editor_client.get(f"/platforms/{platform['id']}/unsaved").json()["entries"] == []
    assert editor_client.get(f"/mdfs/{mdf['id']}/unsaved").json()["entries"] == []

    # A second Emitter pinned on the Platform: stored, but not in a version yet.
    other = _emitter(editor_client, "Late Radar", None, [("Track", "fixed", FIXED)])
    editor_client.post(f"/platforms/{platform['id']}/links", json={"emitter_id": other[0]["id"]})
    unsaved = editor_client.get(f"/platforms/{platform['id']}/unsaved").json()
    assert unsaved["saved_version"] >= 1
    assert [(e["scope"], e["label"]) for e in unsaved["entries"]] == [("Emitter 'Late Radar'", "Pinned")]

    pv = _save(editor_client, "platforms", platform["id"])
    assert editor_client.get(f"/platforms/{platform['id']}/unsaved").json()["entries"] == []
    editor_client.post(f"/mdfs/{mdf['id']}/links", json={"platform_id": platform["id"], "platform_version_id": pv["id"]})
    entries = editor_client.get(f"/mdfs/{mdf['id']}/unsaved").json()["entries"]
    assert [e["label"] for e in entries] == ["Pinned version"]


def test_a_released_mdf_gets_no_outdated_pin_warnings(editor_client):
    _e, platform, mdf = _setup(editor_client)
    # The Platform moves on after it's pinned.
    _save(editor_client, "platforms", platform["id"], "later")
    items = {i["key"]: i for i in editor_client.get(f"/mdfs/{mdf['id']}/readiness").json()}
    assert items["platform_pins"]["status"] == "warn"

    _move(editor_client, mdf["id"], "pending_review", "approved", "released")
    items = {i["key"]: i for i in editor_client.get(f"/mdfs/{mdf['id']}/readiness").json()}
    assert items["platform_pins"]["status"] == "ok" and "Not checked" in items["platform_pins"]["detail"]
    assert items["emitter_pins"]["status"] == "ok"
    _move(editor_client, mdf["id"], "deprecated")
    items = {i["key"]: i for i in editor_client.get(f"/mdfs/{mdf['id']}/readiness").json()}
    assert "Not checked" in items["platform_pins"]["detail"]
    _move(editor_client, mdf["id"], "draft")
    items = {i["key"]: i for i in editor_client.get(f"/mdfs/{mdf['id']}/readiness").json()}
    assert items["platform_pins"]["status"] == "warn"


def test_the_timeline_and_the_summary_since_the_last_release(editor_client):
    emitter, platform, mdf = _setup(editor_client, "History MDF")
    mid = mdf["id"]
    editor_client.post(f"/mdfs/{mid}/goals", json={"text": "Ship it"})
    _move(editor_client, mid, "pending_review", "approved", "released")
    assert editor_client.put(f"/mdfs/{mid}/versions/1/release-notes", json={"text": "First release."}).status_code == 200

    # After the release: the Emitter gains a Mode, the Platform repins it, the MDF repins the Platform.
    group = editor_client.get(f"/emitters/{emitter[0]['id']}/ew-groups").json()[0]
    source = editor_client.get(f"/emitters/{emitter[0]['id']}/sources").json()[0]
    editor_client.post(f"/ew-groups/{group['id']}/modes", json={"source_id": source["id"], "name": "Track", "pri_type": "fixed", "line": FIXED})
    ev2 = _save(editor_client, "emitters", emitter[0]["id"])
    editor_client.post(f"/platforms/{platform['id']}/links", json={"emitter_id": emitter[0]["id"], "emitter_version_id": ev2["id"]})
    pv = _save(editor_client, "platforms", platform["id"])
    editor_client.post(f"/mdfs/{mid}/links", json={"platform_id": platform["id"], "platform_version_id": pv["id"]})
    editor_client.patch(f"/mdfs/{mid}", json={"due_date": "2027-04-15"})
    editor_client.post(f"/mdfs/{mid}/log", json={"kind": "progress", "body": "New Track mode in."})
    v2 = _save(editor_client, "mdfs", mid, "Track mode")
    editor_client.put(f"/mdfs/{mid}/versions/{v2['version_number']}/release-notes", json={"text": "Adds the Track mode."})

    events = editor_client.get(f"/mdfs/{mid}/timeline").json()["events"]
    kinds = {e["kind"] for e in events}
    assert {"version", "status", "goal", "log", "due", "pins"} <= kinds
    newest_version = next(e for e in events if e["kind"] == "version")
    assert newest_version["version_number"] == v2["version_number"] and newest_version["release_notes"] == "Adds the Track mode."
    scopes = [c["scope"] for c in newest_version["changes"]]
    assert any(s.startswith("Platform 'History MDF Ship' → Emitter 'History MDF Radar'") for s in scopes)

    s = editor_client.get(f"/mdfs/{mid}/summary").json()
    assert (s["from_version"], s["to_version"], s["last_release_version"]) == (1, v2["version_number"], 1)
    assert [v["release_notes"] for v in s["versions"]] == ["Adds the Track mode."]
    assert [e["text"] for e in s["log"]] == ["New Track mode in."]
    assert s["contents"][0]["emitters"][0]["version"] == ev2["version_number"]
    whole = editor_client.get(f"/mdfs/{mid}/summary", params={"to_version": 1}).json()
    assert whole["from_version"] is None and whole["versions"][0]["release_notes"] == "First release."
    assert editor_client.get(f"/mdfs/{mid}/summary", params={"from_version": 2, "to_version": 1}).status_code == 422

    doc = editor_client.get(f"/mdfs/{mid}/summary.docx")
    assert doc.status_code == 200 and "release%20notes" in doc.headers["content-disposition"]
    text = zipfile.ZipFile(io.BytesIO(doc.content)).read("word/document.xml").decode()
    for expected in ("History MDF — release notes v2", "Adds the Track mode.", "New Track mode in.", "Ship it", "History MDF Radar"):
        assert expected in text, expected


def test_an_mdf_never_saved_has_nothing_to_summarize(editor_client):
    mdf = editor_client.post("/mdfs", json={"name": "Empty MDF"}).json()
    assert editor_client.get(f"/mdfs/{mdf['id']}/summary").status_code == 409
    assert editor_client.get(f"/mdfs/{mdf['id']}/timeline").json()["events"][0]["kind"] == "created"
