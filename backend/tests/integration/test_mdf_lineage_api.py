"""A new MDF as the next release of an older one: New MDF from this one
copies a saved version's pins into a separate MDF that remembers what it
follows, and its summary (the changelog) counts from that release."""

import io
import zipfile

from tests.integration.test_emitter_report_api import FIXED
from tests.integration.test_mdf_plan_api import _move, _save, _setup


def _new_track_mode(client, emitter, platform):
    """The Emitter gains a Mode; the Platform repins it and saves. The new Platform version."""
    group = client.get(f"/emitters/{emitter[0]['id']}/ew-groups").json()[0]
    source = client.get(f"/emitters/{emitter[0]['id']}/sources").json()[0]
    client.post(f"/ew-groups/{group['id']}/modes", json={"source_id": source["id"], "name": "Track", "pri_type": "fixed", "line": FIXED})
    ev2 = _save(client, "emitters", emitter[0]["id"])
    client.post(f"/platforms/{platform['id']}/links", json={"emitter_id": emitter[0]["id"], "emitter_version_id": ev2["id"]})
    return _save(client, "platforms", platform["id"])


def test_a_new_mdf_follows_the_release_of_the_old_one(editor_client):
    emitter, platform, old = _setup(editor_client, "Fleet 2026")
    _move(editor_client, old["id"], "pending_review", "approved", "released")
    # Saved again after the release: the new MDF still starts from what went out.
    _save(editor_client, "mdfs", old["id"], "After release")
    customer = editor_client.post("/customers", json={"name": "Navy B"}).json()

    resp = editor_client.post(f"/mdfs/{old['id']}/new-mdf", json={"name": "Fleet 2027", "customer_id": customer["id"]})
    assert resp.status_code == 201, resp.text
    new = resp.json()
    assert new["id"] != old["id"] and new["status"] == "draft" and new["customer_id"] == customer["id"]
    assert (new["based_on_mdf_id"], new["based_on_mdf_name"], new["based_on_version_number"]) == (old["id"], "Fleet 2026", 1)
    assert new["platforms_count"] == 1
    versions = editor_client.get(f"/mdfs/{new['id']}/versions").json()
    assert len(versions) == 1 and "Started from 'Fleet 2026' v1" in versions[0]["change_summary"]
    # The old MDF is untouched.
    assert editor_client.get(f"/mdfs/{old['id']}").json()["status"] == "released"

    # The next release changes the Platform; its summary is the changelog since Fleet 2026 v1.
    pv = _new_track_mode(editor_client, emitter, platform)
    editor_client.post(f"/mdfs/{new['id']}/links", json={"platform_id": platform["id"], "platform_version_id": pv["id"]})
    v2 = _save(editor_client, "mdfs", new["id"], "Track mode")
    editor_client.put(f"/mdfs/{new['id']}/versions/{v2['version_number']}/release-notes", json={"text": "Adds the Track mode."})

    s = editor_client.get(f"/mdfs/{new['id']}/summary").json()
    assert s["from_mdf"]["name"] == "Fleet 2026" and s["from_mdf"]["version"] == 1 and s["from_version"] is None
    assert s["previous_mdf"] == {"id": old["id"], "name": "Fleet 2026", "version": 1}
    assert any(c["scope"].startswith("Platform 'Fleet 2026 Ship'") for c in s["changes"])
    assert [v["version_number"] for v in s["versions"]] == [1, 2]
    # The same, asked for; or from the start; or between its own versions.
    assert editor_client.get(f"/mdfs/{new['id']}/summary", params={"base": "previous"}).json()["changes"] == s["changes"]
    start = editor_client.get(f"/mdfs/{new['id']}/summary", params={"base": "start"}).json()
    assert start["from_mdf"] is None and start["from_version"] is None
    own = editor_client.get(f"/mdfs/{new['id']}/summary", params={"from_version": 1}).json()
    assert own["from_mdf"] is None and own["from_version"] == 1
    # The same pin changes; across two MDFs the name change is listed too.
    assert own["changes"] == [c for c in s["changes"] if c["scope"] != "MDF"]
    assert {"scope": "MDF", "label": "Name", "kind": "changed", "old_value": "Fleet 2026", "new_value": "Fleet 2027"} in s["changes"]
    assert not any(c["scope"] == "MDF" and c["label"] == "Status" for c in s["changes"])

    text = zipfile.ZipFile(io.BytesIO(editor_client.get(f"/mdfs/{new['id']}/summary.docx").content)).read("word/document.xml").decode()
    assert "Changes from Fleet 2026 v1" in text and "Adds the Track mode." in text

    # Once the new MDF has a release of its own, the changelog counts from that.
    _move(editor_client, new["id"], "pending_review", "approved", "released")
    _save(editor_client, "mdfs", new["id"], "Later")
    later = editor_client.get(f"/mdfs/{new['id']}/summary").json()
    assert later["from_mdf"] is None and later["from_version"] == v2["version_number"]


def test_an_mdf_made_from_scratch_can_follow_another(editor_client):
    _e, _p, old = _setup(editor_client, "Old Fleet")
    _e2, _p2, new = _setup(editor_client, "New Fleet")
    url = f"/mdfs/{new['id']}"
    # No release yet: it follows the latest saved version.
    r = editor_client.patch(url, json={"based_on_mdf_id": old["id"]})
    assert r.status_code == 200, r.text
    assert (r.json()["based_on_mdf_name"], r.json()["based_on_version_number"]) == ("Old Fleet", 1)
    s = editor_client.get(f"{url}/summary").json()
    assert s["from_mdf"]["name"] == "Old Fleet"
    # Its Platform replaces the old one's.
    kinds = {(c["kind"], c["scope"].split(" →")[0]) for c in s["changes"]}
    assert ("added", "Platform 'New Fleet Ship'") in kinds and ("removed", "Platform 'Old Fleet Ship'") in kinds

    assert editor_client.patch(url, json={"based_on_mdf_id": new["id"]}).status_code == 422
    assert editor_client.patch(url, json={"based_on_mdf_id": old["id"], "based_on_version_number": 9}).status_code == 404
    cleared = editor_client.patch(url, json={"based_on_mdf_id": None}).json()
    assert cleared["based_on_mdf_id"] is None and cleared["based_on_version_number"] is None
    assert editor_client.get(f"{url}/summary").json()["from_mdf"] is None
    assert editor_client.get(f"{url}/summary", params={"base": "previous"}).status_code == 422


def test_new_mdf_needs_a_saved_version_and_a_free_name(editor_client):
    draft = editor_client.post("/mdfs", json={"name": "Never saved"}).json()
    assert editor_client.post(f"/mdfs/{draft['id']}/new-mdf", json={"name": "Copy"}).status_code == 422
    _e, _p, mdf = _setup(editor_client, "Saved Fleet")
    assert editor_client.post(f"/mdfs/{mdf['id']}/new-mdf", json={"name": "Saved Fleet"}).status_code == 409
    assert editor_client.post(f"/mdfs/{mdf['id']}/new-mdf", json={"name": "Copy", "version": 7}).status_code == 404
    assert editor_client.post(f"/mdfs/{mdf['id']}/new-mdf", json={"name": "  "}).status_code == 422
