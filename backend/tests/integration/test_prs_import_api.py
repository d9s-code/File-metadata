import io
import zipfile

import pytest

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
    "rf_range_matching": True,
    "pw_range_matching": False,
    "pri_range_matching": True,
}

STAGGER_LINE = {
    "rf_min_mhz": 5000,
    "rf_max_mhz": 5200,
    "pw_min_us": 1.0,
    "pw_max_us": 2.0,
    "rf_delta": 0,
    "pw_delta": 0,
    "pri_stagger_values_us": [100, 150, 200],
    "frame_time_delta_us": 5,
    "rf_range_matching": False,
    "pw_range_matching": False,
    "pri_range_matching": False,
}

CW_LINE = {
    "rf_min_mhz": 9000,
    "rf_max_mhz": 9100,
    "pw_min_us": 0.1,
    "pw_max_us": 0.2,
    "rf_delta": 0,
    "pw_delta": 0,
    "rf_range_matching": False,
    "pw_range_matching": False,
    "pri_range_matching": False,
}


@pytest.fixture()
def source_emitter(editor_client):
    """A fully-built Emitter (2 EW Groups, 3 Modes across pri_types) whose
    real "Export XML" output becomes the fixture the import tests round-trip
    against — this validates the parser against the actual exporter, not a
    hand-guessed approximation of its format.
    """
    emitter = editor_client.post("/emitters", json={"name": "PRS Export Source"}).json()
    eid = emitter["id"]
    group_a = editor_client.post(
        f"/emitters/{eid}/ew-groups", json={"name": "Search", "scan_min": 2.0, "scan_max": 4.0, "threat_priority": 7, "ageout": 12}
    ).json()
    group_b = editor_client.post(f"/emitters/{eid}/ew-groups", json={"name": "Track"}).json()
    source = editor_client.post(f"/emitters/{eid}/sources", json={"name": "Source A", "source_date": "2025-01-01"}).json()

    fixed_mode = editor_client.post(
        f"/ew-groups/{group_a['id']}/modes",
        json={"source_id": source["id"], "name": "Fixed Search", "pri_type": "fixed", "line": FIXED_LINE},
    ).json()
    stagger_mode = editor_client.post(
        f"/ew-groups/{group_a['id']}/modes",
        json={"source_id": source["id"], "name": "Stagger Search", "pri_type": "stagger", "line": STAGGER_LINE},
    ).json()
    cw_mode = editor_client.post(
        f"/ew-groups/{group_b['id']}/modes",
        json={"source_id": source["id"], "name": "CW Track", "pri_type": "cw", "line": CW_LINE},
    ).json()

    zip_resp = editor_client.post(f"/emitters/{eid}/export/xml")
    assert zip_resp.status_code == 200, zip_resp.text
    with zipfile.ZipFile(io.BytesIO(zip_resp.content)) as zf:
        xml_names = [n for n in zf.namelist() if n.startswith("emitters/")]
        assert len(xml_names) == 1
        xml_bytes = zf.read(xml_names[0])

    return {
        "emitter": emitter,
        "group_a": group_a,
        "group_b": group_b,
        "source": source,
        "fixed_mode": fixed_mode,
        "stagger_mode": stagger_mode,
        "cw_mode": cw_mode,
        "xml_bytes": xml_bytes,
    }


def _import(client, emitter_id, xml_bytes, **form):
    return client.post(
        f"/emitters/{emitter_id}/imports/prs-import",
        files={"file": ("emitter.xml", xml_bytes, "application/xml")},
        data=form,
    )


def test_prs_import_round_trip_into_new_source(editor_client, source_emitter):
    target = editor_client.post("/emitters", json={"name": "PRS Import Target"}).json()
    resp = _import(
        editor_client, target["id"], source_emitter["xml_bytes"],
        new_source_name="Imported Source", source_date="2026-01-01",
    )
    assert resp.status_code == 201, resp.text
    result = resp.json()
    assert result["mode_count"] == 3
    assert result["ew_group_count"] == 2
    assert set(result["created_ew_group_names"]) == {"Search", "Track"}

    modes = editor_client.get(f"/emitters/{target['id']}/modes").json()
    assert len(modes) == 3
    by_name = {m["name"]: m for m in modes}
    assert {"Fixed_Search", "Stagger_Search", "CW_Track"} <= set(by_name)  # exporter sanitizes spaces to underscores

    fixed = by_name["Fixed_Search"]
    assert fixed["pri_type"] == "fixed"
    assert fixed["line"]["rf_min_mhz"] == pytest.approx(2899)  # engineered: raw 2900 - delta 1
    assert fixed["line"]["rf_delta"] == 0  # delta isn't recoverable from the export — forced to 0
    assert fixed["line"]["rf_range_matching"] is True
    assert fixed["line"]["pw_range_matching"] is False

    stagger = by_name["Stagger_Search"]
    assert stagger["pri_type"] == "stagger"
    assert stagger["line"]["pri_stagger_values_us"] == [100, 150, 200]

    cw = by_name["CW_Track"]
    assert cw["pri_type"] == "cw"

    # EW Group scan/threat data came through for the one that had it.
    ew_groups = {g["name"]: g for g in editor_client.get(f"/emitters/{target['id']}/ew-groups").json()}
    assert ew_groups["Search"]["threat_priority"] == 7
    assert ew_groups["Search"]["ageout"] == pytest.approx(12)

    sources = editor_client.get(f"/emitters/{target['id']}/sources").json()
    assert len(sources) == 1
    assert sources[0]["name"] == "Imported Source"
    for m in modes:
        assert m["source_id"] == sources[0]["id"]


def test_prs_import_into_existing_source_and_ew_group(editor_client, source_emitter):
    target = editor_client.post("/emitters", json={"name": "PRS Import Target 2"}).json()
    existing_source = editor_client.post(
        f"/emitters/{target['id']}/sources", json={"name": "Pre-existing Source", "source_date": "2025-01-01"}
    ).json()
    # Pre-create one of the two EW Groups the import will reference, by its
    # (sanitized) name — the importer should match it instead of duplicating.
    existing_group = editor_client.post(f"/emitters/{target['id']}/ew-groups", json={"name": "Search"}).json()

    resp = _import(editor_client, target["id"], source_emitter["xml_bytes"], source_id=existing_source["id"])
    assert resp.status_code == 201, resp.text
    result = resp.json()
    assert result["ew_group_count"] == 1  # only "Track" is new; "Search" already existed
    assert result["created_ew_group_names"] == ["Track"]

    modes = editor_client.get(f"/emitters/{target['id']}/modes").json()
    assert all(m["source_id"] == existing_source["id"] for m in modes)
    search_modes = [m for m in modes if m["ew_group_id"] == existing_group["id"]]
    assert len(search_modes) == 2  # Fixed_Search + Stagger_Search landed in the pre-existing group


def test_prs_import_requires_exactly_one_source_target(editor_client, source_emitter):
    target = editor_client.post("/emitters", json={"name": "PRS Import Target 3"}).json()
    resp = _import(editor_client, target["id"], source_emitter["xml_bytes"])
    assert resp.status_code == 422

    existing_source = editor_client.post(
        f"/emitters/{target['id']}/sources", json={"name": "Both", "source_date": "2025-01-01"}
    ).json()
    resp = _import(
        editor_client, target["id"], source_emitter["xml_bytes"],
        source_id=existing_source["id"], new_source_name="Also this",
    )
    assert resp.status_code == 422


def test_prs_import_rejects_source_from_another_emitter(editor_client, source_emitter):
    target = editor_client.post("/emitters", json={"name": "PRS Import Target 4"}).json()
    other_emitter = editor_client.post("/emitters", json={"name": "Unrelated Emitter"}).json()
    other_source = editor_client.post(
        f"/emitters/{other_emitter['id']}/sources", json={"name": "Foreign Source", "source_date": "2025-01-01"}
    ).json()
    resp = _import(editor_client, target["id"], source_emitter["xml_bytes"], source_id=other_source["id"])
    assert resp.status_code == 404


def test_prs_import_rejects_malformed_xml(editor_client):
    target = editor_client.post("/emitters", json={"name": "PRS Import Target 5"}).json()
    resp = _import(editor_client, target["id"], b"not xml at all <<<", new_source_name="X")
    assert resp.status_code == 422


def test_prs_import_rejects_wrong_root_element(editor_client):
    target = editor_client.post("/emitters", json={"name": "PRS Import Target 6"}).json()
    resp = _import(editor_client, target["id"], b"<NotAnEmitter/>", new_source_name="X")
    assert resp.status_code == 422


def test_prs_import_reports_mode_with_no_scan_data_and_commits_nothing(editor_client, source_emitter):
    target = editor_client.post("/emitters", json={"name": "PRS Import Target 7"}).json()
    xml = source_emitter["xml_bytes"].replace(b'<ScanData Name="Search"/>', b"")
    resp = _import(editor_client, target["id"], xml, new_source_name="X")
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert any("Fixed_Search" in str(d) for d in detail) or any("ScanData" in str(d) for d in detail)
    # All-or-nothing: nothing from the file was imported.
    assert editor_client.get(f"/emitters/{target['id']}/modes").json() == []
    assert editor_client.get(f"/emitters/{target['id']}/ew-groups").json() == []


def test_prs_import_requires_checkout(editor_client, admin_client, source_emitter):
    target = editor_client.post("/emitters", json={"name": "PRS Import Target 8"}).json()
    editor_client.delete(f"/emitters/{target['id']}/checkout")
    resp = _import(editor_client, target["id"], source_emitter["xml_bytes"], new_source_name="X")
    assert resp.status_code == 409


def test_prs_import_is_audited(editor_client, source_emitter):
    target = editor_client.post("/emitters", json={"name": "PRS Import Target 9"}).json()
    _import(editor_client, target["id"], source_emitter["xml_bytes"], new_source_name="X")
    audit = editor_client.get("/audit-log", params={"emitter_id": target["id"], "entity_type": "prs_import"}).json()
    assert len(audit["items"]) == 1
    assert "3 Mode" in audit["items"][0]["summary"]
