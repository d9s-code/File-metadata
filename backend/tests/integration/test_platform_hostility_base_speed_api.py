"""A Platform's hostility (UNKNOWN / FRIEND / HOSTILE / NEUTRAL), base (SEA /
GROUND / SUBSURFACE / UNKNOWN / AIR) and speed (a range in km/h or knots): set
and audited, saved with each Platform version, flagged as unsaved until then,
and written to the Platform's PRS XML as they're stored, in caps."""

import io
import zipfile

from lxml import etree

from tests.integration.test_prs_export_api import _build_mdf


def _platform_xml(client, platform_id, version_number):
    resp = client.get(f"/platforms/{platform_id}/versions/{version_number}/export/prs")
    assert resp.status_code == 200, resp.text
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    name = next(n for n in zf.namelist() if n.startswith("platforms/") and "default_unknown" not in n)
    return etree.fromstring(zf.read(name))


def test_set_on_create_and_in_the_xml(editor_client):
    built = _build_mdf(editor_client)
    pid = built["platform"]["id"]
    # Saved before they were set: unknown, no speed — as the placeholders always were.
    xml = _platform_xml(editor_client, pid, 1)
    assert xml.find("Hostility").get("Value") == "UNKNOWN"
    assert xml.find("Base").get("Value") == "UNKNOWN"
    assert dict(xml.find("Speed").attrib) == {"Min": "0", "Max": "0", "Units": "kph"}

    resp = editor_client.patch(f"/platforms/{pid}", json={"hostility": "HOSTILE", "base": "SEA", "speed_min": 0, "speed_max": 30, "speed_unit": "knots"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["hostility"] == "HOSTILE"
    assert resp.json()["base"] == "SEA"
    assert resp.json()["speed_unit"] == "knots"

    # Unsaved until a version is saved: the XML of v1 is unchanged.
    unsaved = editor_client.get(f"/platforms/{pid}/unsaved").json()
    labels = {e["label"]: (e["old_value"], e["new_value"]) for e in unsaved["entries"]}
    assert labels["Hostility"] == ("UNKNOWN", "HOSTILE")
    assert labels["Base"] == ("UNKNOWN", "SEA")
    assert labels["Highest speed"] == (None, 30.0)
    assert labels["Speed unit"] == ("km/h", "knots")
    assert _platform_xml(editor_client, pid, 1).find("Hostility").get("Value") == "UNKNOWN"

    v2 = editor_client.post(f"/platforms/{pid}/versions", json={}).json()
    xml = _platform_xml(editor_client, pid, v2["version_number"])
    assert xml.find("Hostility").get("Value") == "HOSTILE"
    assert xml.find("Base").get("Value") == "SEA"
    assert dict(xml.find("Speed").attrib) == {"Min": "0", "Max": "30", "Units": "knots"}
    assert editor_client.get(f"/platforms/{pid}/unsaved").json()["entries"] == []

    audit = editor_client.get("/audit-log", params={"entity_type": "platform", "limit": 50}).json()["items"]
    assert any(a["changes"] and "hostility" in a["changes"] for a in audit)


def test_the_mdf_export_carries_it(editor_client):
    platform = editor_client.post(
        "/platforms", json={"name": "Friendly Frigate", "hostility": "FRIEND", "base": "SUBSURFACE", "speed_max": 55.5}
    ).json()
    assert platform["speed_unit"] == "kmh"
    emitter = editor_client.post("/emitters", json={"name": "Nav Radar FF"}).json()
    v = editor_client.post(f"/emitters/{emitter['id']}/versions", json={"change_summary": "v1"}).json()
    editor_client.post(f"/platforms/{platform['id']}/links", json={"emitter_id": emitter["id"], "emitter_version_id": v["id"]})
    pv = editor_client.post(f"/platforms/{platform['id']}/versions", json={}).json()
    xml = _platform_xml(editor_client, platform["id"], pv["version_number"])
    assert xml.find("Hostility").get("Value") == "FRIEND"
    assert xml.find("Base").get("Value") == "SUBSURFACE"
    assert dict(xml.find("Speed").attrib) == {"Min": "0", "Max": "55.5", "Units": "kph"}


def test_rejects_bad_values(editor_client):
    platform = editor_client.post("/platforms", json={"name": "Checked Platform", "speed_max": 20}).json()
    pid = platform["id"]
    assert editor_client.patch(f"/platforms/{pid}", json={"hostility": "ENEMY"}).status_code == 422
    assert editor_client.patch(f"/platforms/{pid}", json={"hostility": "hostile"}).status_code == 422  # caps only
    assert editor_client.patch(f"/platforms/{pid}", json={"base": "SPACE"}).status_code == 422
    assert editor_client.patch(f"/platforms/{pid}", json={"speed_unit": "mph"}).status_code == 422
    assert editor_client.patch(f"/platforms/{pid}", json={"speed_min": -1}).status_code == 422
    # Against the saved highest speed.
    assert editor_client.patch(f"/platforms/{pid}", json={"speed_min": 25}).status_code == 422
    # Back to unknown.
    editor_client.patch(f"/platforms/{pid}", json={"hostility": "NEUTRAL", "base": "AIR"})
    resp = editor_client.patch(f"/platforms/{pid}", json={"hostility": "UNKNOWN", "base": "GROUND"}).json()
    assert (resp["hostility"], resp["base"]) == ("UNKNOWN", "GROUND")


def test_versions_saved_with_the_allegiance_still_export_their_hostility():
    from app.services.pinned_diff_service import platform_hostility
    from app.services.prs_export.serializer import build_platform_element

    old = {"name": "Old Frigate", "allegiance": "friendly", "links": []}
    assert platform_hostility(old) == "FRIEND"
    el = build_platform_element(old)
    assert el.find("Hostility").get("Value") == "FRIEND"
    assert el.find("Base").get("Value") == "UNKNOWN"
