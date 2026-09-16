import io
import zipfile

from lxml import etree


def test_emitter_xml_export_uses_engineered_values_and_real_range_matching(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "XML Export Emitter"}).json()
    ew_group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Group A"}).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Source A", "source_date": "2025-01-01"}
    ).json()
    create_resp = editor_client.post(
        f"/ew-groups/{ew_group['id']}/modes",
        json={
            "source_id": source["id"],
            "name": "Delta Mode",
            "pri_type": "fixed",
            "line": {
                "rf_min_mhz": 2900,
                "rf_max_mhz": 3100,
                "rf_delta": 10,
                "rf_range_matching": True,
                "pw_min_us": 0.5,
                "pw_max_us": 1.2,
                "pw_delta": 0.1,
                "pw_range_matching": False,
                "pri_min_us": 800,
                "pri_max_us": 1200,
                "pri_delta": 20,
                "pri_range_matching": True,
                "jitter_min_us": 5,
                "jitter_max_us": 15,
            },
        },
    )
    assert create_resp.status_code == 201, create_resp.text

    resp = editor_client.post(f"/emitters/{emitter['id']}/export/xml")
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/zip"

    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    xml_bytes = zf.read("emitters/XML_Export_Emitter.xml")
    root = etree.fromstring(xml_bytes)

    mode_el = root.find("Mode")
    assert mode_el is not None, "expected a Mode element in the exported XML"

    range_match = mode_el.find("RangeMatch")
    assert range_match.get("Frequency") == "true"
    assert range_match.get("PulseWidth") == "false"
    assert range_match.get("PRI") == "true"

    freq = mode_el.find("Frequency")
    assert float(freq.get("Min")) == 2890.0  # 2900 - 10
    assert float(freq.get("Max")) == 3110.0  # 3100 + 10

    pw = mode_el.find("PulseWidth")
    assert float(pw.get("Min")) == 0.4  # 0.5 - 0.1
    assert float(pw.get("Max")) == 1.3  # 1.2 + 0.1

    simple_pri = mode_el.find("PRI/SimplePRI")
    assert float(simple_pri.get("Min")) == 780.0  # 800 - 20
    assert float(simple_pri.get("Max")) == 1220.0  # 1200 + 20


def test_emitter_xml_export_scan_period_uses_ew_group_values(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Scan Export Emitter"}).json()
    ew_group = editor_client.post(
        f"/emitters/{emitter['id']}/ew-groups",
        json={"name": "Group A", "scan_min": 2, "scan_max": 4, "scan_delta": 1, "threat_priority": 7, "ageout": 30},
    ).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Source A", "source_date": "2025-01-01"}
    ).json()
    create_resp = editor_client.post(
        f"/ew-groups/{ew_group['id']}/modes",
        json={
            "source_id": source["id"],
            "name": "Scan Mode",
            "pri_type": "fixed",
            "line": {
                "rf_min_mhz": 2900,
                "rf_max_mhz": 3100,
                "rf_delta": 0,
                "rf_range_matching": False,
                "pw_min_us": 0.5,
                "pw_max_us": 1.2,
                "pw_delta": 0,
                "pw_range_matching": False,
                "pri_min_us": 800,
                "pri_max_us": 1200,
                "pri_delta": 0,
                "pri_range_matching": False,
                "jitter_min_us": 5,
                "jitter_max_us": 15,
            },
        },
    )
    assert create_resp.status_code == 201, create_resp.text

    resp = editor_client.post(f"/emitters/{emitter['id']}/export/xml")
    assert resp.status_code == 200, resp.text
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    root = etree.fromstring(zf.read("emitters/Scan_Export_Emitter.xml"))

    period = root.find("Scan/Period")
    # engineered scan = raw (2-4) +/- delta (1) = 1-5, not the 5/10 placeholder
    assert float(period.get("Min")) == 1.0
    assert float(period.get("Max")) == 5.0

    ew_params = root.find("EWParameters")
    assert ew_params.find("ThreatPriority").get("Value") == "7"
    assert float(ew_params.find("Ageout").get("Value")) == 30.0


def test_emitter_xml_export_scan_period_falls_back_without_ew_group_scan_data(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "No Scan Export Emitter"}).json()
    ew_group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Group A"}).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Source A", "source_date": "2025-01-01"}
    ).json()
    create_resp = editor_client.post(
        f"/ew-groups/{ew_group['id']}/modes",
        json={
            "source_id": source["id"],
            "name": "No Scan Mode",
            "pri_type": "fixed",
            "line": {
                "rf_min_mhz": 2900,
                "rf_max_mhz": 3100,
                "rf_delta": 0,
                "rf_range_matching": False,
                "pw_min_us": 0.5,
                "pw_max_us": 1.2,
                "pw_delta": 0,
                "pw_range_matching": False,
                "pri_min_us": 800,
                "pri_max_us": 1200,
                "pri_delta": 0,
                "pri_range_matching": False,
                "jitter_min_us": 5,
                "jitter_max_us": 15,
            },
        },
    )
    assert create_resp.status_code == 201, create_resp.text

    resp = editor_client.post(f"/emitters/{emitter['id']}/export/xml")
    assert resp.status_code == 200, resp.text
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    root = etree.fromstring(zf.read("emitters/No_Scan_Export_Emitter.xml"))
    period = root.find("Scan/Period")
    assert float(period.get("Min")) == 5.0
    assert float(period.get("Max")) == 10.0


def test_emitter_xml_export_stagger_frame_period_uses_engineered_delta(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Stagger Export Emitter"}).json()
    ew_group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Group A"}).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Source A", "source_date": "2025-01-01"}
    ).json()
    create_resp = editor_client.post(
        f"/ew-groups/{ew_group['id']}/modes",
        json={
            "source_id": source["id"],
            "name": "Stagger Mode",
            "pri_type": "stagger",
            "line": {
                "rf_min_mhz": 2900,
                "rf_max_mhz": 3100,
                "rf_delta": 0,
                "rf_range_matching": False,
                "pw_min_us": 0.5,
                "pw_max_us": 1.2,
                "pw_delta": 0,
                "pw_range_matching": False,
                "pri_range_matching": False,
                "pri_stagger_values_us": [100, 200, 300, 400, 500],
                "frame_time_delta_us": 15,
            },
        },
    )
    assert create_resp.status_code == 201, create_resp.text

    resp = editor_client.post(f"/emitters/{emitter['id']}/export/xml")
    assert resp.status_code == 200, resp.text
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    root = etree.fromstring(zf.read("emitters/Stagger_Export_Emitter.xml"))
    mode_el = root.find("Mode")
    frame_period = mode_el.find("PRI/FramePeriod")
    # sum([100,200,300,400,500]) = 1500, frame_time_delta_us = 15
    assert float(frame_period.get("Min")) == 1485.0
    assert float(frame_period.get("Max")) == 1515.0
