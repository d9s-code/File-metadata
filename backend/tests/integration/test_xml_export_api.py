from lxml import etree

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


def test_export_endpoint_returns_full_xml_for_committed_mdf_version(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Export Emitter", "designation": "TEST-1"}).json()
    ew_group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Group A"}).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Secret Source Name", "source_date": "2025-01-01"}
    ).json()
    editor_client.post(
        f"/ew-groups/{ew_group['id']}/modes",
        json={"source_id": source["id"], "name": "Export Mode", "pri_type": "fixed", "line": FIXED_LINE},
    )
    emitter_v1 = editor_client.post(f"/emitters/{emitter['id']}/versions", json={}).json()

    platform = editor_client.post("/platforms", json={"name": "Export Platform"}).json()
    editor_client.post(
        f"/platforms/{platform['id']}/links", json={"emitter_id": emitter["id"], "emitter_version_id": emitter_v1["id"]}
    )
    platform_v1 = editor_client.post(f"/platforms/{platform['id']}/versions", json={}).json()

    mdf = editor_client.post("/mdfs", json={"name": "Export MDF"}).json()
    editor_client.post(
        f"/mdfs/{mdf['id']}/links", json={"platform_id": platform["id"], "platform_version_id": platform_v1["id"]}
    )
    editor_client.post(f"/mdfs/{mdf['id']}/versions", json={})

    resp = editor_client.get(f"/mdfs/{mdf['id']}/versions/1/export.xml")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/xml")
    assert "attachment" in resp.headers["content-disposition"]

    root = etree.fromstring(resp.content)
    assert root.tag == "MissionDataFile"
    assert root.find("Platforms/Platform/Name").text == "Export Platform"
    assert root.find("Platforms/Platform/Emitters/Emitter/Name").text == "Export Emitter"
    assert root.find("Platforms/Platform/Emitters/Emitter/Designation").text == "TEST-1"
    mode = root.find(".//Modes/Mode")
    assert mode.find("Name").text == "Export Mode"
    assert mode.find("ModeLine/RfMin").text == "2900.0"  # snapshot values pass through Python float()

    assert b"Secret Source Name" not in resp.content


def test_export_404_for_missing_version(editor_client):
    mdf = editor_client.post("/mdfs", json={"name": "No Version MDF"}).json()
    resp = editor_client.get(f"/mdfs/{mdf['id']}/versions/1/export.xml")
    assert resp.status_code == 404


def test_viewer_can_export(viewer_client, editor_client):
    mdf = editor_client.post("/mdfs", json={"name": "Viewer Export MDF"}).json()
    editor_client.post(f"/mdfs/{mdf['id']}/versions", json={})
    resp = viewer_client.get(f"/mdfs/{mdf['id']}/versions/1/export.xml")
    assert resp.status_code == 200
