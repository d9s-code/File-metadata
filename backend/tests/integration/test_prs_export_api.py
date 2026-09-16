import io
import zipfile

from lxml import etree

FIXED_LINE_RM = {
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
    "rf_range_matching": True,
    "pw_range_matching": False,
    "pri_range_matching": True,
}

STAGGER_LINE = {
    "rf_min_mhz": 2900,
    "rf_max_mhz": 3100,
    "pw_min_us": 0.5,
    "pw_max_us": 1.2,
    "rf_delta": 1,
    "pw_delta": 0.05,
    "pri_stagger_values_us": [100, 200, 300, 400, 500],
    "frame_time_delta_us": 15,
    "rf_range_matching": False,
    "pw_range_matching": False,
    "pri_range_matching": False,
}

_PRS_NS = "urn:com:bae:prs:pfm:library"


def _build_mdf(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "PRS Export Emitter", "designation": "TEST-PRS"}).json()
    ew_group = editor_client.post(
        f"/emitters/{emitter['id']}/ew-groups",
        json={"name": "PRS Group", "scan_min": 5, "scan_max": 10, "threat_priority": 7, "ageout": 12},
    ).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Secret PRS Source", "source_date": "2025-01-01"}
    ).json()
    editor_client.post(
        f"/ew-groups/{ew_group['id']}/modes",
        json={"source_id": source["id"], "name": "RM Mode", "pri_type": "fixed", "line": FIXED_LINE_RM},
    )
    editor_client.post(
        f"/ew-groups/{ew_group['id']}/modes",
        json={"source_id": source["id"], "name": "Stagger Mode", "pri_type": "stagger", "line": STAGGER_LINE},
    )
    emitter_v1 = editor_client.post(f"/emitters/{emitter['id']}/versions", json={"change_summary": "test"}).json()

    platform = editor_client.post("/platforms", json={"name": "PRS Export Platform"}).json()
    editor_client.post(
        f"/platforms/{platform['id']}/links",
        json={"emitter_id": emitter["id"], "emitter_version_id": emitter_v1["id"]},
    )
    platform_v1 = editor_client.post(f"/platforms/{platform['id']}/versions", json={}).json()

    mdf = editor_client.post("/mdfs", json={"name": "PRS Export MDF"}).json()
    editor_client.post(
        f"/mdfs/{mdf['id']}/links", json={"platform_id": platform["id"], "platform_version_id": platform_v1["id"]}
    )
    editor_client.post(f"/mdfs/{mdf['id']}/versions", json={})

    return {"emitter": emitter, "platform": platform, "mdf": mdf}


def _emitter_xml_from_zip(zf: zipfile.ZipFile, name: str) -> etree._Element:
    return etree.fromstring(zf.read(f"emitters/{name}.xml"))


def test_mdf_prs_export_returns_zip_with_expected_structure(editor_client):
    ctx = _build_mdf(editor_client)
    mdf_id = ctx["mdf"]["id"]

    resp = editor_client.get(f"/mdfs/{mdf_id}/versions/1/export/prs")
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/zip"
    assert "attachment" in resp.headers["content-disposition"]

    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = set(zf.namelist())
    assert "platforms/default_unknown_platform.xml" in names
    assert "emitters/default_unknown_emitter.xml" in names
    assert "platforms/PRS_Export_Platform.xml" in names
    assert "emitters/PRS_Export_Emitter.xml" in names
    assert "PRS_Export_MDF.xml" in names

    root = etree.fromstring(zf.read("PRS_Export_MDF.xml"))
    assert etree.QName(root).localname == "ThreatLibrary"
    assert etree.QName(root).namespace == _PRS_NS
    assert root.find(f"{{{_PRS_NS}}}DefaultUnknown").text == "platforms\\default_unknown_platform.xml"
    assert root.find(f"{{{_PRS_NS}}}MDF/{{{_PRS_NS}}}Name").text == "PRS_Export_MDF"

    platform_el = etree.fromstring(zf.read("platforms/PRS_Export_Platform.xml"))
    assert platform_el.find("Name").text == "PRS_Export_Platform"
    assert platform_el.find("Configuration/EmitterFile").text == "emitters\\PRS_Export_Emitter.xml"

    # Sources are an authoring-only construct and must never leak into the export.
    assert b"Secret PRS Source" not in resp.content


def test_prs_export_emits_real_ageout_and_per_parameter_range_matching(editor_client):
    ctx = _build_mdf(editor_client)
    mdf_id = ctx["mdf"]["id"]

    resp = editor_client.get(f"/mdfs/{mdf_id}/versions/1/export/prs")
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    emitter_el = _emitter_xml_from_zip(zf, "PRS_Export_Emitter")

    ageout_el = emitter_el.find("EWParameters/Ageout")
    assert ageout_el.get("Value") == "12"

    rm_mode = next(m for m in emitter_el.findall("Mode") if m.find("Name") is None and m.get("Name") == "RM_Mode")
    range_match = rm_mode.find("RangeMatch")
    assert range_match.get("Frequency") == "true"  # rf_range_matching
    assert range_match.get("PulseWidth") == "false"  # pw_range_matching
    assert range_match.get("PRI") == "true"  # pri_range_matching


def test_prs_export_stagger_mode_frame_period_uses_engineered_delta(editor_client):
    ctx = _build_mdf(editor_client)
    mdf_id = ctx["mdf"]["id"]

    resp = editor_client.get(f"/mdfs/{mdf_id}/versions/1/export/prs")
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    emitter_el = _emitter_xml_from_zip(zf, "PRS_Export_Emitter")

    stagger_mode = next(m for m in emitter_el.findall("Mode") if m.get("Name") == "Stagger_Mode")
    pri_el = stagger_mode.find("PRI")
    assert pri_el.get("Class") == "Stagger"
    frame_period = pri_el.find("FramePeriod")
    # sum([100,200,300,400,500]) = 1500, frame_time_delta_us = 15
    assert frame_period.get("Min") == "1485"
    assert frame_period.get("Max") == "1515"
    levels = [level.get("Value") for level in pri_el.findall("StaggerLevels/Level")]
    assert levels == ["100", "200", "300", "400", "500"]


def test_prs_export_cw_pri_block_has_no_children(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "CW Emitter"}).json()
    ew_group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "CW Group"}).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "CW Source", "source_date": "2025-01-01"}
    ).json()
    cw_line = {
        "rf_min_mhz": 2900,
        "rf_max_mhz": 3100,
        "pw_min_us": 0.5,
        "pw_max_us": 1.2,
        "rf_delta": 1,
        "pw_delta": 0.05,
        "rf_range_matching": False,
        "pw_range_matching": False,
        "pri_range_matching": False,
    }
    editor_client.post(
        f"/ew-groups/{ew_group['id']}/modes",
        json={"source_id": source["id"], "name": "CW Mode", "pri_type": "cw", "line": cw_line},
    )
    emitter_v1 = editor_client.post(f"/emitters/{emitter['id']}/versions", json={"change_summary": "test"}).json()
    platform = editor_client.post("/platforms", json={"name": "CW Platform"}).json()
    editor_client.post(
        f"/platforms/{platform['id']}/links",
        json={"emitter_id": emitter["id"], "emitter_version_id": emitter_v1["id"]},
    )
    # Platform creation auto-commits an initial (link-less) version, so the
    # version with the link is whatever number this explicit commit returns,
    # not necessarily 1 — use it rather than assuming.
    platform_v = editor_client.post(f"/platforms/{platform['id']}/versions", json={}).json()

    resp = editor_client.get(f"/platforms/{platform['id']}/versions/{platform_v['version_number']}/export/prs")
    assert resp.status_code == 200, resp.text
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    emitter_el = _emitter_xml_from_zip(zf, "CW_Emitter")
    mode_el = emitter_el.find("Mode")
    pri_el = mode_el.find("PRI")
    assert pri_el.get("Class") == "CW"
    assert len(pri_el) == 0


def test_platform_prs_export_uses_platform_as_synthetic_root(editor_client):
    ctx = _build_mdf(editor_client)
    platform_id = ctx["platform"]["id"]
    # Platform creation auto-commits an initial (link-less) version, so the
    # version with the real link is the latest one, not necessarily 1.
    versions = editor_client.get(f"/platforms/{platform_id}/versions").json()
    version_number = versions[-1]["version_number"]

    resp = editor_client.get(f"/platforms/{platform_id}/versions/{version_number}/export/prs")
    assert resp.status_code == 200, resp.text
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    assert "PRS_Export_Platform.xml" in zf.namelist()
    root = etree.fromstring(zf.read("PRS_Export_Platform.xml"))
    assert root.find(f"{{{_PRS_NS}}}MDF/{{{_PRS_NS}}}Name").text == "PRS_Export_Platform"


def test_prs_export_404_for_missing_version(editor_client):
    mdf = editor_client.post("/mdfs", json={"name": "No Version PRS MDF"}).json()
    resp = editor_client.get(f"/mdfs/{mdf['id']}/versions/1/export/prs")
    assert resp.status_code == 404


def test_prs_export_sanitizes_slash_in_emitter_and_platform_names(editor_client):
    # Real-world designations often contain a slash (e.g. "AN/APG-99"), which
    # must not leak into the zip as a path separator or into the referencing
    # XML as a broken path.
    emitter = editor_client.post("/emitters", json={"name": "AN/APG-99 Sample"}).json()
    ew_group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Slash Group"}).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Slash Source", "source_date": "2025-01-01"}
    ).json()
    editor_client.post(
        f"/ew-groups/{ew_group['id']}/modes",
        json={"source_id": source["id"], "name": "Slash Mode", "pri_type": "fixed", "line": FIXED_LINE_RM},
    )
    emitter_v1 = editor_client.post(f"/emitters/{emitter['id']}/versions", json={"change_summary": "test"}).json()

    platform = editor_client.post("/platforms", json={"name": "A/B Platform"}).json()
    editor_client.post(
        f"/platforms/{platform['id']}/links",
        json={"emitter_id": emitter["id"], "emitter_version_id": emitter_v1["id"]},
    )
    # Platform creation auto-commits an initial (link-less) version — same
    # reasoning as the CW test above.
    platform_v = editor_client.post(f"/platforms/{platform['id']}/versions", json={}).json()

    resp = editor_client.get(f"/platforms/{platform['id']}/versions/{platform_v['version_number']}/export/prs")
    assert resp.status_code == 200, resp.text
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = set(zf.namelist())

    # No unintended nested directory from the slash, and no bare "/" left in
    # any path segment.
    assert "emitters/AN_APG-99_Sample.xml" in names
    assert "platforms/A_B_Platform.xml" in names
    assert not any(n.startswith("emitters/AN/") for n in names)

    platform_el = etree.fromstring(zf.read("platforms/A_B_Platform.xml"))
    assert platform_el.find("Configuration/EmitterFile").text == "emitters\\AN_APG-99_Sample.xml"


def test_viewer_can_export_prs(viewer_client, editor_client):
    mdf = editor_client.post("/mdfs", json={"name": "Viewer PRS Export MDF"}).json()
    editor_client.post(f"/mdfs/{mdf['id']}/versions", json={})
    resp = viewer_client.get(f"/mdfs/{mdf['id']}/versions/1/export/prs")
    assert resp.status_code == 200
