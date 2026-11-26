"""A radar's operational modes: each Emitter's own (volume search, track…),
its Modes linked to the one they're transmitted in, taking its illumination
time for the dwell planner. Edited like EW Groups, saved with the Emitter's
versions, compared, reverted and duplicated with it."""

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


def test_operational_modes_link_modes_and_give_them_their_illumination_time(editor_client):
    e, g, s = _emitter(editor_client)
    url = f"/emitters/{e['id']}/operational-modes"
    volume = editor_client.post(url, json={"name": "Volume search", "illumination_time_ms": 45}).json()
    track = editor_client.post(url, json={"name": "Track", "description": "Fire control"}).json()
    assert (volume["illumination_time_ms"], track["illumination_time_ms"]) == (45, None)
    # Names are the Emitter's own: no two alike, none blank.
    assert editor_client.post(url, json={"name": "Track"}).status_code == 409
    assert editor_client.patch(f"{url}/{track['id']}", json={"name": "  "}).status_code == 422

    search = _mode(editor_client, g, s, "Search", operational_mode_id=volume["id"])
    assert search["operational_mode_id"] == volume["id"]
    lone = _mode(editor_client, g, s, "Lone")
    # Linked in the batch edit, by name in the Audit Log.
    r = editor_client.post(
        f"/emitters/{e['id']}/modes/batch-edit", json={"mode_ids": [lone["id"]], "fields": {"operational_mode_id": track["id"]}}
    )
    assert r.status_code == 200, r.text
    log = editor_client.get("/audit-log", params={"entity_type": "mode", "entity_id": lone["id"]}).json()
    entries = log["items"] if isinstance(log, dict) else log
    assert any((x.get("changes") or {}).get("operational_mode") == {"old": None, "new": "Track"} for x in entries)

    # Another Emitter's operational mode can't be linked.
    other, _, _ = _emitter(editor_client, "Other")
    foreign = editor_client.post(f"/emitters/{other['id']}/operational-modes", json={"name": "Foreign"}).json()
    r = editor_client.patch(f"/ew-groups/{g['id']}/modes/{lone['id']}", json={"operational_mode_id": foreign["id"]})
    assert r.status_code == 404, r.text

    listed = {o["name"]: o["modes_count"] for o in editor_client.get(url).json()}
    assert listed == {"Track": 1, "Volume search": 1}

    # The planner: Search takes Volume search's 45 ms; Lone's Track has none, so it says nothing.
    v = editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"}).json()
    p = editor_client.post("/platforms", json={"name": "MFR Platform"}).json()
    editor_client.post(f"/platforms/{p['id']}/links", json={"emitter_id": e["id"], "emitter_version_id": v["id"]})
    [cov] = editor_client.get(f"/platforms/{p['id']}/coverage").json()
    planner = {m["name"]: m["planner"] for m in cov["modes"]}
    assert (planner["Search"]["operational_mode"], planner["Search"]["illumination_time_ms"]) == ("Volume search", 45)
    assert (planner["Lone"]["operational_mode"], planner["Lone"]["illumination_time_ms"]) == ("Track", None)
    assert cov["illumination_time_ms"] == 20

    # Deleted, its Modes stay — linked to none.
    assert editor_client.delete(f"{url}/{track['id']}").status_code == 204
    lone_now = next(m for m in editor_client.get(f"/ew-groups/{g['id']}/modes").json() if m["id"] == lone["id"])
    assert lone_now["operational_mode_id"] is None


def test_versions_compare_revert_and_duplicate_them(editor_client):
    e, g, s = _emitter(editor_client)
    url = f"/emitters/{e['id']}/operational-modes"
    a = editor_client.post(url, json={"name": "A", "illumination_time_ms": 10}).json()
    b = editor_client.post(url, json={"name": "B"}).json()
    m = _mode(editor_client, g, s, "M", operational_mode_id=a["id"])
    v1 = editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"}).json()

    # Swap their names, change A's time, move M to B, add C, and save.
    editor_client.patch(f"{url}/{a['id']}", json={"name": "tmp"})
    editor_client.patch(f"{url}/{b['id']}", json={"name": "A"})
    editor_client.patch(f"{url}/{a['id']}", json={"name": "B", "illumination_time_ms": 12})
    editor_client.post(url, json={"name": "C"})
    editor_client.patch(f"/ew-groups/{g['id']}/modes/{m['id']}", json={"operational_mode_id": b["id"]})
    v2 = editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v2"}).json()
    diff = editor_client.get(f"/emitters/{e['id']}/versions/{v2['version_number']}/diff").json()["entries"]
    seen = {(d["scope"], d["label"], d["old_value"], d["new_value"]) for d in diff}
    # By id: M left the old A (renamed B since) for the old B (renamed A).
    assert ("Mode 'M'", "Operational mode", "A (now 'B')", "A") in seen
    assert any(d["scope"] == "Operational mode 'C'" and d["kind"] == "added" for d in diff)
    assert any(d["label"] == "Illumination time (ms)" and (d["old_value"], d["new_value"]) == (10, 12) for d in diff)

    # Back to v1: names swapped back, C gone, M on A again.
    r = editor_client.post(f"/emitters/{e['id']}/versions/{v1['version_number']}/revert")
    assert r.status_code == 200, r.text
    rows = {o["id"]: (o["name"], o["illumination_time_ms"]) for o in editor_client.get(url).json()}
    assert rows == {a["id"]: ("A", 10), b["id"]: ("B", None)}
    back = next(x for x in editor_client.get(f"/ew-groups/{g['id']}/modes").json() if x["id"] == m["id"])
    assert back["operational_mode_id"] == a["id"]

    # A duplicate gets its own operational modes, its Modes linked to them.
    copy = editor_client.post(f"/emitters/{e['id']}/duplicate", json={"new_name": "MFR copy"})
    assert copy.status_code in (200, 201), copy.text
    copy_id = copy.json()["id"]
    copied = {o["name"]: o for o in editor_client.get(f"/emitters/{copy_id}/operational-modes").json()}
    assert set(copied) == {"A", "B"} and copied["A"]["id"] != a["id"]
    [copy_group] = editor_client.get(f"/emitters/{copy_id}/ew-groups").json()
    [copy_mode] = editor_client.get(f"/ew-groups/{copy_group['id']}/modes").json()
    assert copy_mode["operational_mode_id"] == copied["A"]["id"]
