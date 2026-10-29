"""The analysis sheet: Modes with their Sources and notes, every value as
typed and with its delta (shaded), Sources, Elements and notes."""

import io
import re
import xml.etree.ElementTree as ET
import zipfile

from tests.integration.test_ambiguity_api import FIXED_LINE

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def _sheet(content: bytes, n: int) -> tuple[list[list], dict[tuple[int, int], str]]:
    """Sheet n's rows (strings, numbers or None) and each cell's style."""
    root = ET.fromstring(zipfile.ZipFile(io.BytesIO(content)).read(f"xl/worksheets/sheet{n}.xml"))
    rows, styles = [], {}
    for r, row in enumerate(root.find("m:sheetData", NS)):
        cells: dict[int, object] = {}
        for c in row:
            col = 0
            for ch in re.match(r"[A-Z]+", c.get("r")).group():
                col = col * 26 + ord(ch) - 64
            styles[(r, col - 1)] = c.get("s", "0")
            if c.get("t") == "inlineStr":
                cells[col - 1] = "".join(t.text or "" for t in c.iter(f"{{{NS['m']}}}t"))
            else:
                cells[col - 1] = float(c.find("m:v", NS).text)
        rows.append([cells.get(i) for i in range(max(cells) + 1)] if cells else [])
    return rows, styles


def test_the_analysis_sheet(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Analysis Radar", "designation": "AR-1"}).json()
    eid = emitter["id"]
    group = editor_client.post(f"/emitters/{eid}/ew-groups", json={"name": "Search", "scan_min": 2, "scan_max": 4}).json()
    source = editor_client.post(f"/emitters/{eid}/sources", json={"name": "Datasheet", "source_date": "2026-01-01", "source_type": "Manual"}).json()
    editor_client.post(f"/emitters/{eid}/sources/{source['id']}/elements", json={"element_type": "rf", "value_min": 2900, "value_max": 3100, "delta": 5})
    editor_client.post(f"/emitters/{eid}/sources/{source['id']}/notes", json={"body": "Checked against the original"})
    editor_client.post(f"/emitters/{eid}/notes", json={"body": "Seen on range day 3"})
    editor_client.post(
        f"/ew-groups/{group['id']}/modes",
        json={"source_id": source["id"], "name": "Search 1", "pri_type": "fixed", "notes": "From the datasheet", "line": FIXED_LINE},
    )
    editor_client.post(f"/emitters/{eid}/versions", json={"change_summary": "v1"})

    resp = editor_client.post("/reports/analysis", json={"emitter_ids": [eid]})
    assert resp.status_code == 200, resp.text
    assert 'filename="Analysis sheet' in resp.headers["content-disposition"]

    modes, styles = _sheet(resp.content, 1)
    header, row = modes[0], modes[1]
    cell = dict(zip(header, row))
    assert cell["Emitter"] == "Analysis Radar" and cell["Version"] == "v1" and cell["Sources"] == "Datasheet"
    assert cell["Mode Notes"] == "From the datasheet"
    # As typed, the delta, and with it applied (shaded).
    assert (cell["RF Min [MHz]"], cell["RF Max [MHz]"], cell["RF ± [MHz]"]) == (2900, 3100, 1)
    assert (cell["RF Min ±Δ [MHz]"], cell["RF Max ±Δ [MHz]"]) == (2899, 3101)
    shaded = header.index("RF Min ±Δ [MHz]")
    assert styles[(0, shaded)] == "3" and styles[(1, shaded)] == "2"
    assert styles[(1, header.index("RF Min [MHz]"))] == "0"
    assert (cell["Scan Min [ms]"], cell["Scan Max [ms]"]) == (2000, 4000)

    sources, _ = _sheet(resp.content, 2)
    src = dict(zip(sources[0], sources[1]))
    assert src["Source"] == "Datasheet" and src["Modes Citing It"] == "Search 1" and src["Elements"] == 1
    assert src["Notes"].startswith("Checked against the original (editor")

    elements, _ = _sheet(resp.content, 3)
    el = dict(zip(elements[0], elements[1]))
    assert (el["Type"], el["Min"], el["Max"], el["±"], el["Min ±Δ"], el["Max ±Δ"]) == ("RF", 2900, 3100, 5, 2895, 3105)

    notes, _ = _sheet(resp.content, 4)
    assert {r[1] for r in notes[1:]} == {"Emitter", "Source Datasheet"}

    assert editor_client.post("/reports/analysis", json={}).status_code == 422
