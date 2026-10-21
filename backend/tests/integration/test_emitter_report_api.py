"""The Emitter report: a spreadsheet line per Mode of the Platforms and
Emitters picked, in alphabetical order throughout."""

import io
import re
import zipfile
import xml.etree.ElementTree as ET

from app.services.emitter_report_service import HEADER

# The designation column, by its place in the header.
DESIGNATION = HEADER[2]

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

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


def _read_sheet(content: bytes) -> list[list]:
    """The first sheet's rows, each cell a string, a number or None."""
    z = zipfile.ZipFile(io.BytesIO(content))
    root = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows = []
    for row in root.find("m:sheetData", NS):
        cells: dict[int, object] = {}
        for c in row:
            letters = re.match(r"[A-Z]+", c.get("r")).group()
            col = 0
            for ch in letters:
                col = col * 26 + ord(ch) - 64
            if c.get("t") == "inlineStr":
                cells[col - 1] = "".join(t.text or "" for t in c.iter(f"{{{NS['m']}}}t"))
            else:
                cells[col - 1] = float(c.find("m:v", NS).text)
        rows.append([cells.get(i) for i in range(max(cells) + 1)] if cells else [])
    return rows


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


def test_the_report_lists_each_mode_in_alphabetical_order(editor_client):
    zulu = _emitter(editor_client, "Zulu Radar", "ZR-1", [("Search 10", "fixed", FIXED), ("Search 2", "stagger", STAGGER)])
    alpha = _emitter(editor_client, "Alpha Radar", "AR-1", [("Track", "fixed", FIXED)])
    loose = _emitter(editor_client, "Loose Radar", None, [("Only", "cw", {**FIXED, "pri_min_us": None, "pri_max_us": None,
                                                                           "pri_delta": None, "jitter_min_us": None,
                                                                           "jitter_max_us": None})])
    south = _platform(editor_client, "South", zulu, alpha)
    north = _platform(editor_client, "north", zulu)

    resp = editor_client.post(
        "/reports/emitters",
        json={
            "platform_ids": [south["id"], north["id"]],
            # Alpha is on South already, so it isn't listed again on its own.
            "emitter_ids": [loose[0]["id"], alpha[0]["id"]],
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    assert ".xlsx" in resp.headers["content-disposition"]
    rows = _read_sheet(resp.content)
    header = rows[0]
    assert header[:4] == ["Platform", "Emitter", DESIGNATION, "Mode"]
    assert header[-1] == "Stagger 32 [µs]" and len(header) == 23 + 32

    # Platforms alphabetically (whatever the case), each one's Emitters, then their Modes (numbers by value).
    assert [(r[0], r[1], r[3]) for r in rows[1:]] == [
        ("north", "Zulu Radar", "Search 2"),
        ("north", "Zulu Radar", "Search 10"),
        ("South", "Alpha Radar", "Track"),
        ("South", "Zulu Radar", "Search 2"),
        ("South", "Zulu Radar", "Search 10"),
        (None, "Loose Radar", "Only"),
    ]
    col = {name: i for i, name in enumerate(header)}
    fixed = rows[2]
    assert fixed[col[DESIGNATION]] == "ZR-1"
    assert (fixed[col["Ageout [s]"]], fixed[col["Threat Priority"]]) == (30, 4)
    assert (fixed[col["Quality"]], fixed[col["Quantity"]]) == (100, 2)
    # Scan period in ms; frequency, PW and PRI with their margins, as the PRS export has them.
    assert (fixed[col["Period Min [ms]"]], fixed[col["Period Max [ms]"]]) == (2500, 3000)
    assert (fixed[col["Frequency Min [MHz]"]], fixed[col["Frequency Max [MHz]"]]) == (8995, 9105)
    assert (fixed[col["Pulse Width Min [µs]"]], fixed[col["Pulse Width Max [µs]"]]) == (0.4, 1.6)
    assert (fixed[col["PRI Type"]], fixed[col["PRI Min [µs]"]], fixed[col["PRI Max [µs]"]]) == ("Fixed", 993, 1007)
    assert (fixed[col["Jitter Min [µs]"]], fixed[col["Jitter Max [µs]"]]) == (0, 1)
    assert fixed[col["Polarization"]] is None and fixed[col["Scan Type"]] is None

    stagger = rows[1]
    assert stagger[col["PRI Type"]] == "Stagger" and stagger[col["PRI Min [µs]"]] is None
    # Frame time: the steps' sum, ± its margin; then each step.
    assert (stagger[col["Frame Min [µs]"]], stagger[col["Frame Max [µs]"]]) == (2646, 2654)
    assert stagger[col["Stagger 1 [µs]"] : col["Stagger 3 [µs]"] + 1] == [700, 750, 1200]
    assert rows[-1][col["PRI Type"]] == "CW" and rows[-1][col[DESIGNATION]] is None


def test_the_report_needs_a_pick_and_is_open_to_viewers(editor_client, viewer_client):
    assert editor_client.post("/reports/emitters", json={}).status_code == 422
    emitter, _ = _emitter(editor_client, "Viewed Radar", "VR", [("Search", "fixed", FIXED)])
    empty = editor_client.post("/emitters", json={"name": "Empty Radar"}).json()
    resp = viewer_client.post("/reports/emitters", json={"emitter_ids": [emitter["id"], empty["id"]]})
    assert resp.status_code == 200, resp.text
    # One without Modes still gets a line, its Mode's columns empty.
    assert [(r[1], r[3] if len(r) > 3 else None) for r in _read_sheet(resp.content)[1:]] == [
        ("Empty Radar", None),
        ("Viewed Radar", "Search"),
    ]
    missing = editor_client.post("/reports/emitters", json={"emitter_ids": ["00000000-0000-0000-0000-000000000000"]})
    assert missing.status_code == 422
