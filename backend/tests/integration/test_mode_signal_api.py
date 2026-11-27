"""How a Mode's signal behaves — RF, PRI and PW behaviour, intra-pulse
modulation, polarisation — and an EW Group's ERP: checked, saved with the
Emitter's versions, compared, reverted and duplicated. For analysis only:
the export is exactly what it was without them."""

import io
import zipfile

from tests.integration.test_emitter_scans_api import _emitter, _mode
from tests.integration.test_prs_export_api import _build_mdf

SIGNAL = {
    "rf": {"kind": "hopping", "channels_mhz": [9400, 9420, 9440, 9460], "hop_pulses": 8, "order": "random"},
    "pri": {"kind": "sliding", "period_ms": 20, "shape": "up"},
    "pw": {"kind": "agile", "values_us": [0.5, 1]},
    "modulation": {"kind": "lfm", "bandwidth_mhz": 5, "direction": "up"},
    "polarisation": "horizontal",
}


def test_a_modes_signal_is_checked_and_kept_lean(editor_client):
    _e, g, s = _emitter(editor_client)
    m = _mode(editor_client, g, s, "Agile", signal=SIGNAL)
    assert m["signal"]["rf"]["channels_mhz"] == [9400, 9420, 9440, 9460]
    assert m["signal"]["modulation"] == {"kind": "lfm", "bandwidth_mhz": 5, "direction": "up"}
    # Plain throughout: nothing kept.
    plain = _mode(editor_client, g, s, "Plain", signal={"rf": {"kind": "fixed"}, "pri": {"kind": "steady"}, "modulation": {"kind": "none"}})
    assert plain["signal"] is None
    url = f"/ew-groups/{g['id']}/modes/{m['id']}"
    for bad in (
        {"rf": {"kind": "hopping", "channels_mhz": [9400], "hop_pulses": 8}},
        {"rf": {"kind": "hopping", "channels_mhz": [9400, 9500]}},
        {"rf": {"kind": "swept"}},
        {"pri": {"kind": "dwell_switch", "values_us": [100, 200]}},
        {"pw": {"kind": "sequence", "values_us": [1]}},
        {"modulation": {"kind": "phase"}},
        {"polarisation": "sideways"},
        {"pri": {"kind": "wobulated", "period_ms": 5}},
    ):
        assert editor_client.patch(url, json={"signal": bad}).status_code == 422, bad
    r = editor_client.patch(url, json={"signal": None})
    assert r.status_code == 200 and r.json()["signal"] is None
    # A PRI behaviour is a Fixed PRI's.
    stagger_line = {k: v for k, v in m["line"].items() if v is not None and not k.startswith(("pri_", "jitter"))}
    line = {**stagger_line, "pri_range_matching": False, "pri_stagger_values_us": [300, 400], "frame_time_delta_us": 0}
    body = {"source_id": s["id"], "name": "Stag", "pri_type": "stagger", "line": line}
    r = editor_client.post(f"/ew-groups/{g['id']}/modes", json={**body, "signal": {"pri": {"kind": "sliding", "period_ms": 5}}})
    assert r.status_code == 422, r.text


def test_an_ew_groups_erp(editor_client):
    e, g, _s = _emitter(editor_client)
    url = f"/emitters/{e['id']}/ew-groups/{g['id']}"
    r = editor_client.patch(url, json={"erp_min_dbm": 70, "erp_max_dbm": 85})
    assert r.status_code == 200 and (r.json()["erp_min_dbm"], r.json()["erp_max_dbm"]) == (70, 85), r.text
    assert editor_client.patch(url, json={"erp_min_dbm": 90}).status_code == 422
    assert editor_client.post(f"/emitters/{e['id']}/ew-groups", json={"name": "Bad", "erp_min_dbm": 90, "erp_max_dbm": 80}).status_code == 422


def test_versioned_compared_reverted_and_duplicated(editor_client):
    e, g, s = _emitter(editor_client)
    m = _mode(editor_client, g, s, "M")
    editor_client.patch(f"/emitters/{e['id']}/ew-groups/{g['id']}", json={"erp_min_dbm": 70, "erp_max_dbm": 80})
    v1 = editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"}).json()
    editor_client.patch(f"/ew-groups/{g['id']}/modes/{m['id']}", json={"signal": SIGNAL})
    editor_client.patch(f"/emitters/{e['id']}/ew-groups/{g['id']}", json={"erp_max_dbm": 85})
    v2 = editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v2"}).json()
    diff = editor_client.get(f"/emitters/{e['id']}/versions/{v2['version_number']}/diff").json()["entries"]
    seen = {(d["scope"], d["label"]): (d["old_value"], d["new_value"]) for d in diff}
    expected = (
        "RF hopping over 4 channels (9400/9420/9440/9460 MHz), a hop every 8 pulses at random · PRI sliding up over 20 ms"
        " · PW agile 0.5/1 µs · LFM 5 MHz up · horizontal"
    )
    assert seen[("Mode 'M'", "Signal")] == (None, expected)
    assert seen[("EW Group 'All'", "ERP max (dBm)")] == (80, 85)
    assert editor_client.post(f"/emitters/{e['id']}/versions/{v1['version_number']}/revert").status_code == 200
    back = next(x for x in editor_client.get(f"/ew-groups/{g['id']}/modes").json() if x["id"] == m["id"])
    assert back["signal"] is None
    assert editor_client.get(f"/emitters/{e['id']}/ew-groups").json()[0]["erp_max_dbm"] == 80
    editor_client.patch(f"/ew-groups/{g['id']}/modes/{m['id']}", json={"signal": SIGNAL})
    copy = editor_client.post(f"/emitters/{e['id']}/duplicate", json={"new_name": "MFR copy"}).json()
    [cg] = editor_client.get(f"/emitters/{copy['id']}/ew-groups").json()
    [cm] = editor_client.get(f"/ew-groups/{cg['id']}/modes").json()
    assert cm["signal"] == back["signal"] or cm["signal"]["polarisation"] == "horizontal"
    assert cg["erp_min_dbm"] == 70


def _export(client, emitter_id: str) -> dict[str, bytes]:
    r = client.post("/emitters/export/xml", json={"emitter_ids": [emitter_id]})
    assert r.status_code == 200, r.text
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    return {n: zf.read(n) for n in zf.namelist()}


def test_the_export_is_exactly_what_it_was_without_them(editor_client):
    built = _build_mdf(editor_client)
    emitter = built["emitter"]
    before = _export(editor_client, emitter["id"])
    [group] = editor_client.get(f"/emitters/{emitter['id']}/ew-groups").json()
    r = editor_client.patch(f"/emitters/{emitter['id']}/ew-groups/{group['id']}", json={"erp_min_dbm": 60, "erp_max_dbm": 95})
    assert r.status_code == 200, r.text
    rm = next(m for m in editor_client.get(f"/ew-groups/{group['id']}/modes").json() if m["name"] == "RM Mode")
    r = editor_client.patch(f"/ew-groups/{group['id']}/modes/{rm['id']}", json={"signal": SIGNAL})
    assert r.status_code == 200, r.text
    editor_client.post(f"/emitters/{emitter['id']}/versions", json={"change_summary": "signal"})
    after = _export(editor_client, emitter["id"])
    # The same files, byte for byte: neither the signal nor the ERP reaches the export.
    assert set(after) == set(before) and before
    for n in before:
        assert after[n] == before[n], n
