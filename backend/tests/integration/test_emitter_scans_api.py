"""An Emitter's scans: each a pattern with its values and beamwidths. An
operational mode uses one (the ones under it inherit it), a Mode can use its
own; the planner gets the Mode's scan. Edited only by the editor holding the
Emitter, saved with its versions, compared, reverted, duplicated, discarded."""

from tests.integration.test_platform_uniqueness_api import LINE


def _emitter(client, name="MFR"):
    e = client.post("/emitters", json={"name": name, "illumination_time_ms": 20}).json()
    g = client.post(f"/emitters/{e['id']}/ew-groups", json={"name": "All", "scan_min": 1, "scan_max": 10}).json()
    s = client.post(f"/emitters/{e['id']}/sources", json={"name": "S", "source_date": "2026-01-01"}).json()
    return e, g, s


def _mode(client, g, s, name, **extra):
    r = client.post(
        f"/ew-groups/{g['id']}/modes",
        json={"source_id": s["id"], "name": name, "pri_type": "fixed", "line": {**LINE, "pri_min_us": 990, "pri_max_us": 1000}, **extra},
    )
    assert r.status_code == 201, r.text
    return r.json()


def _coverage(client, e, name):
    v = client.post(f"/emitters/{e['id']}/versions", json={"change_summary": name}).json()
    p = client.post("/platforms", json={"name": f"{name} Platform"}).json()
    client.post(f"/platforms/{p['id']}/links", json={"emitter_id": e["id"], "emitter_version_id": v["id"]})
    [cov] = client.get(f"/platforms/{p['id']}/coverage").json()
    return v, {m["name"]: m["planner"] for m in cov["modes"]}


def test_scans_are_checked_against_their_pattern(editor_client):
    e, _g, _s = _emitter(editor_client)
    url = f"/emitters/{e['id']}/scans"
    r = editor_client.post(
        url,
        json={"name": "Surveillance", "pattern": "circular", "params": {"period_s": 10, "period_s_delta": 0.2}, "beam_az_deg": 1.5},
    )
    assert r.status_code == 201, r.text
    scan = r.json()
    assert (scan["params"], scan["beam_az_deg"], scan["modes_count"]) == ({"period_s": 10, "period_s_delta": 0.2}, 1.5, 0)
    # Unknown pattern, a value the pattern doesn't take, a negative one, a clash of names.
    assert editor_client.post(url, json={"name": "X", "pattern": "zigzag"}).status_code == 422
    assert editor_client.post(url, json={"name": "X", "pattern": "circular", "params": {"bars": 3}}).status_code == 422
    assert editor_client.post(url, json={"name": "X", "pattern": "circular", "params": {"period_s": -1}}).status_code == 422
    assert editor_client.post(url, json={"name": "Surveillance", "pattern": "steady"}).status_code == 409
    # Another pattern keeps only the values it takes too.
    r = editor_client.patch(f"{url}/{scan['id']}", json={"pattern": "helical"})
    assert (r.status_code, r.json()["params"]) == (200, {"period_s": 10, "period_s_delta": 0.2})
    r = editor_client.patch(f"{url}/{scan['id']}", json={"pattern": "raster"})
    assert (r.status_code, r.json()["params"]) == (200, None)
    r = editor_client.patch(f"{url}/{scan['id']}", json={"params": {"sector_deg": 90, "bars": 4, "bar_spacing_deg": 2, "frame_s": 4}})
    assert r.status_code == 200 and r.json()["params"]["bars"] == 4, r.text
    log = editor_client.get("/audit-log", params={"emitter_id": e["id"]}).json()["items"]
    assert "Created scan 'Surveillance'" in [x["summary"] for x in log]


def test_an_operational_modes_scan_goes_to_its_modes_unless_one_has_its_own(editor_client):
    e, g, s = _emitter(editor_client)
    scans = f"/emitters/{e['id']}/scans"
    rotate = editor_client.post(scans, json={"name": "Rotate", "pattern": "circular", "params": {"period_s": 10}, "beam_az_deg": 2}).json()
    dwell = editor_client.post(scans, json={"name": "Dwell", "pattern": "esa", "params": {"pulses": 16, "revisit_s": 0.5}}).json()
    url = f"/emitters/{e['id']}/operational-modes"
    search = editor_client.post(url, json={"name": "SEARCH", "scan_id": rotate["id"]}).json()
    volume = editor_client.post(url, json={"name": "Volume", "parent_id": search["id"]}).json()
    assert search["scan_id"] == rotate["id"] and volume["scan_id"] is None
    _mode(editor_client, g, s, "V", operational_mode_id=volume["id"])
    own = _mode(editor_client, g, s, "Own", operational_mode_id=volume["id"], scan_id=dwell["id"])
    _mode(editor_client, g, s, "None")
    # Another Emitter's scan can't be used.
    other, _, _ = _emitter(editor_client, "Other")
    foreign = editor_client.post(f"/emitters/{other['id']}/scans", json={"name": "F", "pattern": "steady"}).json()
    assert editor_client.patch(f"/ew-groups/{g['id']}/modes/{own['id']}", json={"scan_id": foreign["id"]}).status_code == 404
    assert editor_client.patch(f"{url}/{volume['id']}", json={"scan_id": foreign["id"]}).status_code == 404
    counts = {x["name"]: (x["operational_modes_count"], x["modes_count"]) for x in editor_client.get(scans).json()}
    assert counts == {"Rotate": (1, 0), "Dwell": (0, 1)}

    _v, plan = _coverage(editor_client, e, "Scans")
    assert (plan["V"]["scan"]["name"], plan["V"]["scan_from"], plan["V"]["scan_from_operational"]) == ("Rotate", "operational", "SEARCH")
    assert plan["V"]["scan"]["params"] == {"period_s": 10} and plan["V"]["scan"]["beam_az_deg"] == 2
    assert (plan["Own"]["scan"]["pattern"], plan["Own"]["scan_from"]) == ("esa", "mode")
    assert (plan["None"]["scan"], plan["None"]["scan_s"]) == (None, [1, 10])

    # Batch edit gives Modes a scan, by name in the Audit Log.
    r = editor_client.post(f"/emitters/{e['id']}/modes/batch-edit", json={"mode_ids": [own["id"]], "fields": {"scan_id": rotate["id"]}})
    assert r.status_code == 200, r.text
    log = editor_client.get("/audit-log", params={"entity_type": "mode", "entity_id": own["id"]}).json()["items"]
    assert any((x.get("changes") or {}).get("scan") == {"old": "Dwell", "new": "Rotate"} for x in log)

    # Deleted, what used it has none of its own.
    assert editor_client.delete(f"{scans}/{rotate['id']}").status_code == 204
    assert {o["name"]: o["scan_id"] for o in editor_client.get(url).json()}["SEARCH"] is None
    assert next(m for m in editor_client.get(f"/ew-groups/{g['id']}/modes").json() if m["id"] == own["id"])["scan_id"] is None


def test_scans_are_versioned_compared_reverted_and_duplicated(editor_client):
    e, g, s = _emitter(editor_client)
    scans = f"/emitters/{e['id']}/scans"
    a = editor_client.post(scans, json={"name": "A", "pattern": "circular", "params": {"period_s": 10}}).json()
    b = editor_client.post(scans, json={"name": "B", "pattern": "sector_bi", "params": {"sector_deg": 90, "sweep_s": 2}}).json()
    op = editor_client.post(f"/emitters/{e['id']}/operational-modes", json={"name": "SEARCH", "scan_id": a["id"]}).json()
    m = _mode(editor_client, g, s, "M", scan_id=b["id"])
    v1 = editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"}).json()

    editor_client.patch(f"{scans}/{a['id']}", json={"params": {"period_s": 12}, "name": "A2"})
    editor_client.patch(f"/emitters/{e['id']}/operational-modes/{op['id']}", json={"scan_id": b["id"]})
    editor_client.patch(f"/ew-groups/{g['id']}/modes/{m['id']}", json={"scan_id": None})
    editor_client.post(scans, json={"name": "C", "pattern": "steady"})
    v2 = editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v2"}).json()
    diff = editor_client.get(f"/emitters/{e['id']}/versions/{v2['version_number']}/diff").json()["entries"]
    seen = {(d["scope"], d["label"], d["old_value"], d["new_value"]) for d in diff}
    assert ("Scan 'A2'", "Values", "period 10 s", "period 12 s") in seen
    assert ("Operational mode 'SEARCH'", "Scan", "A (now 'A2')", "B") in seen
    assert ("Mode 'M'", "Scan", "B", None) in seen
    assert any(d["scope"] == "Scan 'C'" and d["kind"] == "added" for d in diff)

    assert editor_client.post(f"/emitters/{e['id']}/versions/{v1['version_number']}/revert").status_code == 200
    rows = {x["name"]: x for x in editor_client.get(scans).json()}
    assert set(rows) == {"A", "B"} and rows["A"]["params"] == {"period_s": 10}
    assert editor_client.get(f"/emitters/{e['id']}/operational-modes").json()[0]["scan_id"] == a["id"]
    assert next(x for x in editor_client.get(f"/ew-groups/{g['id']}/modes").json() if x["id"] == m["id"])["scan_id"] == b["id"]

    copy = editor_client.post(f"/emitters/{e['id']}/duplicate", json={"new_name": "MFR copy"}).json()
    copied = {x["name"]: x for x in editor_client.get(f"/emitters/{copy['id']}/scans").json()}
    assert set(copied) == {"A", "B"} and copied["A"]["id"] != a["id"]
    [copy_op] = editor_client.get(f"/emitters/{copy['id']}/operational-modes").json()
    assert copy_op["scan_id"] == copied["A"]["id"]
    [copy_group] = editor_client.get(f"/emitters/{copy['id']}/ew-groups").json()
    [copy_mode] = editor_client.get(f"/ew-groups/{copy_group['id']}/modes").json()
    assert copy_mode["scan_id"] == copied["B"]["id"]


def test_only_the_editor_holding_the_emitter_edits_its_scans(editor_client, viewer_client):
    e, _g, _s = _emitter(editor_client)
    scans = f"/emitters/{e['id']}/scans"
    assert viewer_client.get(scans).status_code == 200
    assert viewer_client.post(scans, json={"name": "X", "pattern": "steady"}).status_code in (401, 403)
