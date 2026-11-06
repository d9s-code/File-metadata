"""The Emitter report: laid out exactly like the other app's import report
(a Platforms and an Emitters sheet, the same headers), its values read back
from the PRS export."""

import io
import zipfile

from lxml import etree

from app.services.emitter_report_service import HEADER, PLATFORM_HEADER, STAGGER_COLUMNS, emitter_rows
from scripts.compare_reports import read_workbook

# The designation column, by its place in the header.
DESIGNATION = HEADER[1]

FIXED = {
    "rf_min_mhz": 9000,
    "rf_max_mhz": 9100,
    "rf_delta": 5,
    "pw_min_us": 0.5,
    "pw_max_us": 1.5,
    "pw_delta": 0.1,
    "pri_min_us": 995,
    "pri_max_us": 1005,
    "pri_delta": 2,
    "jitter_min_us": 0,
    "jitter_max_us": 1,
    "rf_range_matching": False,
    "pw_range_matching": False,
    "pri_range_matching": False,
}
STAGGER = {
    "rf_min_mhz": 3000,
    "rf_max_mhz": 3000,
    "rf_delta": 0,
    "pw_min_us": 1,
    "pw_max_us": 1,
    "pw_delta": 0,
    "pri_stagger_values_us": [700, 750, 1200],
    "frame_time_delta_us": 4,
    "rf_range_matching": False,
    "pw_range_matching": False,
    "pri_range_matching": False,
}


def _emitter(client, name, designation, modes):
    emitter = client.post("/emitters", json={"name": name, "designation": designation}).json()
    group = client.post(
        f"/emitters/{emitter['id']}/ew-groups",
        json={"name": "Track", "scan_min": 2.5, "scan_max": 3, "threat_priority": 4, "ageout": 30},
    ).json()
    source = client.post(f"/emitters/{emitter['id']}/sources", json={"name": "Report", "source_date": "2026-01-01"}).json()
    for mode_name, pri_type, line in modes:
        resp = client.post(
            f"/ew-groups/{group['id']}/modes",
            json={"source_id": source["id"], "name": mode_name, "pri_type": pri_type, "line": line},
        )
        assert resp.status_code == 201, resp.text
    version = client.post(f"/emitters/{emitter['id']}/versions", json={"change_summary": "v1"}).json()
    return emitter, version


def _platform(client, name, *pins):
    platform = client.post("/platforms", json={"name": name}).json()
    for emitter, version in pins:
        resp = client.post(
            f"/platforms/{platform['id']}/links", json={"emitter_id": emitter["id"], "emitter_version_id": version["id"]}
        )
        assert resp.status_code == 201, resp.text
    return platform


def _sheets(content: bytes) -> dict[str, list[list]]:
    return read_workbook(io.BytesIO(content))


def _cols(header: list) -> dict[str, int]:
    return {name: i for i, name in enumerate(header)}


def test_the_report_has_the_other_apps_sheets_headers_and_export_values(editor_client):
    zulu = _emitter(editor_client, "Zulu Radar", "ZR-1", [("Search 10", "fixed", FIXED), ("Search 2", "stagger", STAGGER)])
    alpha = _emitter(editor_client, "Alpha Radar", "AR-1", [("Track", "fixed", FIXED)])
    loose = _emitter(editor_client, "Loose Radar", None, [("Only", "cw", {**FIXED, "pri_min_us": None, "pri_max_us": None,
                                                                           "pri_delta": None, "jitter_min_us": None,
                                                                           "jitter_max_us": None})])
    south = _platform(editor_client, "South", zulu, alpha)
    north = _platform(editor_client, "north", zulu)

    resp = editor_client.post(
        "/reports/emitters",
        json={"platform_ids": [south["id"], north["id"]], "emitter_ids": [loose[0]["id"], alpha[0]["id"]]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    assert ".xlsx" in resp.headers["content-disposition"]
    sheets = _sheets(resp.content)
    assert list(sheets) == ["Platforms", "Emitters"]

    platforms = sheets["Platforms"]
    assert platforms[0] == PLATFORM_HEADER
    # The Unknown Platform every export carries, then the Platforms alphabetically.
    assert platforms[1:] == [
        ["Unknown", "UNKNOWN", "UNKNOWN", 0, 0, "kph"],
        ["north", "UNKNOWN", "UNKNOWN", 0, 0, "kph"],
        ["South", "UNKNOWN", "UNKNOWN", 0, 0, "kph"],
    ]

    rows = sheets["Emitters"]
    header = rows[0]
    assert header == HEADER + [f"Stagger {i} [µs]" for i in range(1, STAGGER_COLUMNS + 1)]
    assert len(header) == 54 and header[19:22] == ["Jitter Max\u00a0[µs]", "Frame Min\u00a0[µs]", "Frame max [µs]"]
    # Each Emitter once (Zulu is on both Platforms), names as the export writes them.
    assert [(r[0], r[2] if len(r) > 2 else None) for r in rows[1:]] == [
        ("Unknown", None),
        ("Alpha_Radar", "Track"),
        ("Loose_Radar", "Only"),
        ("Zulu_Radar", "Search_2"),
        ("Zulu_Radar", "Search_10"),
    ]
    col = _cols(header)
    fixed = rows[5]
    assert fixed[col[DESIGNATION]] == "ZR-1"
    assert (fixed[col["Polarization"]], fixed[col["Scan Type"]]) == ("IGNORED", "Undetermined")
    assert (fixed[col["Ageout [s]"]], fixed[col["Threat Priority"]]) == (30, 4)
    assert (fixed[col["Quality"]], fixed[col["Quantity"]]) == (100, 2)
    # Scan period in ms; frequency, PW and PRI with their deltas, as the PRS export has them.
    assert (fixed[col["Period Min [ms]"]], fixed[col["Period Max [ms]"]]) == (2500, 3000)
    assert (fixed[col["Frequency Min [MHz]"]], fixed[col["Frequency Max [MHz]"]]) == (8995, 9105)
    assert (fixed[col["Pulse Width Min [µs]"]], fixed[col["Pulse Width Max [µs]"]]) == (0.4, 1.6)
    assert (fixed[col["PRI Type"]], fixed[col["PRI Min [µs]"]], fixed[col["PRI Max [µs]"]]) == ("Simple", 993, 1007)
    assert (fixed[col["Jitter Min [µs]"]], fixed[col["Jitter Max\u00a0[µs]"]]) == (0, 1)
    assert len(fixed) == col["Jitter Max\u00a0[µs]"] + 1  # no frame time or steps

    stagger = rows[4]
    assert stagger[col["PRI Type"]] == "Stagger" and stagger[col["PRI Min [µs]"]] is None
    # Frame time: the steps' sum, ± its delta; then each step.
    assert (stagger[col["Frame Min\u00a0[µs]"]], stagger[col["Frame max [µs]"]]) == (2646, 2654)
    assert stagger[col["Stagger 1 [µs]"] : col["Stagger 3 [µs]"] + 1] == [700, 750, 1200]
    cw = rows[3]
    assert cw[col["PRI Type"]] == "CW" and cw[col[DESIGNATION]] is None and len(cw) == col["PRI Type"] + 1


def test_the_report_needs_a_pick_and_is_open_to_viewers(editor_client, viewer_client):
    assert editor_client.post("/reports/emitters", json={}).status_code == 422
    emitter, _ = _emitter(editor_client, "Viewed Radar", "VR", [("Search", "fixed", FIXED)])
    empty = editor_client.post("/emitters", json={"name": "Empty Radar"}).json()
    resp = viewer_client.post("/reports/emitters", json={"emitter_ids": [emitter["id"], empty["id"]]})
    assert resp.status_code == 200, resp.text
    sheets = _sheets(resp.content)
    assert sheets["Platforms"][1:] == [["Unknown", "UNKNOWN", "UNKNOWN", 0, 0, "kph"]]
    # One without Modes still gets a line, its Mode's columns empty.
    assert [(r[0], r[2] if len(r) > 2 else None) for r in sheets["Emitters"][1:]] == [
        ("Unknown", None),
        ("Empty_Radar", None),
        ("Viewed_Radar", "Search"),
    ]
    missing = editor_client.post("/reports/emitters", json={"emitter_ids": ["00000000-0000-0000-0000-000000000000"]})
    assert missing.status_code == 422


def test_an_mdf_report_is_for_a_saved_version(editor_client, viewer_client):
    zulu = _emitter(editor_client, "Zulu Radar", "ZR-1", [("Search 10", "fixed", FIXED), ("Search 2", "stagger", STAGGER)])
    alpha = _emitter(editor_client, "Alpha Radar", "AR-1", [("Track", "fixed", FIXED)])
    south = _platform(editor_client, "South", zulu, alpha)
    north = _platform(editor_client, "north", zulu)
    mdf = editor_client.post("/mdfs", json={"name": "Fleet MDF"}).json()
    no_version = editor_client.get(f"/reports/mdfs/{mdf['id']}")
    assert no_version.status_code == 422 and "no saved version" in no_version.json()["detail"]
    for platform in (south, north):
        version = editor_client.post(f"/platforms/{platform['id']}/versions", json={"change_summary": "v"}).json()
        r = editor_client.post(f"/mdfs/{mdf['id']}/links", json={"platform_id": platform["id"], "platform_version_id": version["id"]})
        assert r.status_code == 201, r.text
    assert editor_client.get(f"/reports/mdfs/{mdf['id']}").status_code == 422  # pinned, but not saved yet
    assert editor_client.post(f"/mdfs/{mdf['id']}/versions", json={"change_summary": "Release 1"}).status_code == 201
    # Changed after the version was saved: the report keeps to the saved version.
    editor_client.patch(f"/platforms/{south['id']}", json={"name": "South renamed"})
    editor_client.delete(f"/mdfs/{mdf['id']}/links/{north['id']}")

    resp = viewer_client.get(f"/reports/mdfs/{mdf['id']}")
    assert resp.status_code == 200, resp.text
    assert "MDF%20report%20Fleet%20MDF%20v1" in resp.headers["content-disposition"]
    sheets = _sheets(resp.content)
    assert [r[0] for r in sheets["Platforms"][1:]] == ["Unknown", "north", "South"]
    rows = sheets["Emitters"]
    assert [(r[0], r[2] if len(r) > 2 else None) for r in rows[1:]] == [
        ("Unknown", None),
        ("Alpha_Radar", "Track"),
        ("Zulu_Radar", "Search_2"),
        ("Zulu_Radar", "Search_10"),
    ]
    col = _cols(rows[0])
    assert (rows[2][col["Frequency Min [MHz]"]], rows[2][col["Frequency Max [MHz]"]]) == (8995, 9105)

    # The same lines as reading the version's PRS export file by file.
    export = zipfile.ZipFile(io.BytesIO(viewer_client.get(f"/mdfs/{mdf['id']}/versions/1/export/prs").content))
    def trimmed(row):  # empty cells at the end aren't written
        while row and row[-1] is None:
            row = row[:-1]
        return row

    from_zip = [
        trimmed(row)
        for name in export.namelist()
        if name.startswith("emitters/")
        for row in emitter_rows(etree.fromstring(export.read(name)))
    ]
    assert sorted(map(repr, rows[1:])) == sorted(map(repr, from_zip))

    # A second version without north; the first can still be asked for.
    assert editor_client.post(f"/mdfs/{mdf['id']}/versions", json={"change_summary": "Release 2"}).status_code == 201
    latest = _sheets(viewer_client.get(f"/reports/mdfs/{mdf['id']}").content)
    assert [r[0] for r in latest["Platforms"][1:]] == ["Unknown", "South"]
    first = viewer_client.get(f"/reports/mdfs/{mdf['id']}", params={"version": 1})
    assert first.status_code == 200 and "v1" in first.headers["content-disposition"]
    assert _sheets(first.content) == sheets
    assert viewer_client.get(f"/reports/mdfs/{mdf['id']}", params={"version": 9}).status_code == 422
    assert viewer_client.get("/reports/mdfs/00000000-0000-0000-0000-000000000000").status_code == 404
