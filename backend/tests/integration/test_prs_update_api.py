"""Update from PRS: Modes changed in place from a PRS Emitter XML file."""

import json

import pytest
from lxml import etree

from tests.integration.test_prs_import_api import (
    source_emitter,  # noqa: F401  (fixture)
)


def _edit_xml(xml_bytes: bytes, mode_name: str, element: str, **attrs) -> bytes:
    root = etree.fromstring(xml_bytes)
    mode = next(m for m in root.findall("Mode") if m.get("Name") == mode_name)
    el = mode.find(element)
    for k, v in attrs.items():
        el.set(k, str(v))
    return etree.tostring(root)


def _post(client, emitter_id, xml_bytes, mode_ids, path="prs-update", **form):
    data = {"mode_ids": json.dumps(mode_ids), **form}
    if "pairs" in data and not isinstance(data["pairs"], str):
        data["pairs"] = json.dumps(data["pairs"])
    return client.post(
        f"/emitters/{emitter_id}/imports/{path}",
        files={"file": ("emitter.xml", xml_bytes, "application/xml")},
        data=data,
    )


def _ids(src):
    return [src["fixed_mode"]["id"], src["stagger_mode"]["id"], src["cw_mode"]["id"]]


def test_own_export_pairs_by_name_and_only_the_deltas_change(editor_client, source_emitter):  # noqa: F811
    eid = source_emitter["emitter"]["id"]
    resp = _post(editor_client, eid, source_emitter["xml_bytes"], _ids(source_emitter), path="prs-update/preview")
    assert resp.status_code == 200, resp.text
    preview = resp.json()
    names = {f["index"]: f["name"] for f in preview["file_modes"]}
    pairs = {p["mode_name"]: p for p in preview["pairs"]}
    for pair in pairs.values():
        # The export writes spaces as underscores; the pair is still made by name.
        assert pair["match"] == "name"
        assert names[pair["file_index"]] == pair["mode_name"].replace(" ", "_")
    # The file's values include the deltas: taken as typed, the deltas removed.
    fixed = pairs["Fixed Search"]["changes"]
    assert fixed["rf_min_mhz"] == {"old": 2900.0, "new": 2899.0}
    assert fixed["rf_delta"] == {"old": 1.0, "new": 0.0}
    assert fixed["pri_delta"]["new"] == 0.0
    assert any("delta" in n for n in pairs["Fixed Search"]["notes"])
    # No deltas to remove (a Stagger's frame period maps back as frame time ± half its width).
    assert pairs["Stagger Search"]["changes"] == {}
    assert pairs["CW Track"]["changes"] == {}

    resp = _post(editor_client, eid, source_emitter["xml_bytes"], _ids(source_emitter))
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"updated": ["Fixed Search"], "unchanged": ["Stagger Search", "CW Track"], "skipped": []}


def test_updates_the_mode_in_place_without_its_deltas(editor_client, source_emitter):  # noqa: F811
    eid = source_emitter["emitter"]["id"]
    fixed = source_emitter["fixed_mode"]
    # Changed in the other app: RF from 2,949 and quality 80.
    xml = _edit_xml(source_emitter["xml_bytes"], "Fixed_Search", "Frequency", Min="2949.0")
    xml = _edit_xml(xml, "Fixed_Search", "ConfirmationQuality", Value="80")

    preview = _post(editor_client, eid, xml, [fixed["id"]], path="prs-update/preview").json()
    changes = preview["pairs"][0]["changes"]
    assert changes["rf_min_mhz"] == {"old": 2900.0, "new": 2949.0}
    assert changes["confirmation_quality"]["new"] == 80

    resp = _post(editor_client, eid, xml, [fixed["id"]])
    assert resp.status_code == 200, resp.text
    assert resp.json()["updated"] == ["Fixed Search"]

    modes = {m["id"]: m for m in editor_client.get(f"/emitters/{eid}/modes").json()}
    assert len(modes) == 3  # nothing added or removed
    after = modes[fixed["id"]]
    assert after["name"] == "Fixed Search"
    assert after["line"]["rf_min_mhz"] == pytest.approx(2949)
    assert after["line"]["rf_max_mhz"] == pytest.approx(3101)
    assert after["line"]["rf_delta"] == 0
    assert after["line"]["pw_delta"] == 0
    assert after["confirmation_quality"] == 80

    audit = editor_client.get("/audit-log", params={"emitter_id": eid}).json()["items"]
    summaries = [a["summary"] for a in audit]
    # The Mode's own entry, as an edit from the form, says where it came from.
    assert any(s.startswith("Updated Mode 'Fixed Search' from PRS XML") for s in summaries)
    assert any(s.startswith("Updated 1 Mode(s) from PRS XML") for s in summaries)


def test_pairs_can_be_picked_and_each_file_mode_used_once(editor_client, source_emitter):  # noqa: F811
    eid = source_emitter["emitter"]["id"]
    preview = _post(editor_client, eid, source_emitter["xml_bytes"], _ids(source_emitter), path="prs-update/preview").json()
    by_name = {f["name"]: f["index"] for f in preview["file_modes"]}
    fixed, cw = source_emitter["fixed_mode"]["id"], source_emitter["cw_mode"]["id"]

    twice = _post(editor_client, eid, source_emitter["xml_bytes"], [fixed, cw], pairs={fixed: by_name["CW_Track"], cw: by_name["CW_Track"]})
    assert twice.status_code == 422

    # CW Track left out: skipped, untouched.
    resp = _post(editor_client, eid, source_emitter["xml_bytes"], [fixed, cw], pairs={fixed: by_name["Fixed_Search"], cw: None})
    assert resp.status_code == 200, resp.text
    assert resp.json()["skipped"] == ["CW Track"]

    # Picked across PRI types: the CW Mode becomes the file's Fixed one.
    resp = _post(editor_client, eid, source_emitter["xml_bytes"], [cw], pairs={cw: by_name["Fixed_Search"]})
    assert resp.status_code == 200, resp.text
    after = next(m for m in editor_client.get(f"/emitters/{eid}/modes").json() if m["id"] == cw)
    assert after["pri_type"] == "fixed"
    assert after["name"] == "CW Track"


def test_needs_the_emitter_checked_out(editor_client, source_emitter):  # noqa: F811
    eid = source_emitter["emitter"]["id"]
    editor_client.delete(f"/emitters/{eid}/checkout")
    resp = _post(editor_client, eid, source_emitter["xml_bytes"], _ids(source_emitter))
    assert resp.status_code == 409


def test_rejects_a_mode_of_another_emitter(editor_client, source_emitter):  # noqa: F811
    other = editor_client.post("/emitters", json={"name": "Another"}).json()
    resp = _post(editor_client, other["id"], source_emitter["xml_bytes"], _ids(source_emitter), path="prs-update/preview")
    assert resp.status_code == 404
