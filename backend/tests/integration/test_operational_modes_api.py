"""A radar's operational modes: each Emitter's own (volume search, track…),
its Modes linked to the one they're transmitted in, taking its scan for the
dwell planner (see test_emitter_scans_api). Edited like EW Groups, saved with the Emitter's
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


def test_operational_modes_link_modes(editor_client):
    e, g, s = _emitter(editor_client)
    url = f"/emitters/{e['id']}/operational-modes"
    volume = editor_client.post(url, json={"name": "Volume search"}).json()
    track = editor_client.post(url, json={"name": "Track", "description": "Fire control"}).json()
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

    # The planner: each Mode's operational mode by name.
    v = editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"}).json()
    p = editor_client.post("/platforms", json={"name": "MFR Platform"}).json()
    editor_client.post(f"/platforms/{p['id']}/links", json={"emitter_id": e["id"], "emitter_version_id": v["id"]})
    [cov] = editor_client.get(f"/platforms/{p['id']}/coverage").json()
    planner = {m["name"]: m["planner"] for m in cov["modes"]}
    assert (planner["Search"]["operational_mode"], planner["Lone"]["operational_mode"]) == ("Volume search", "Track")
    assert cov["illumination_time_ms"] == 20

    # Deleted, its Modes stay — linked to none.
    assert editor_client.delete(f"{url}/{track['id']}").status_code == 204
    lone_now = next(m for m in editor_client.get(f"/ew-groups/{g['id']}/modes").json() if m["id"] == lone["id"])
    assert lone_now["operational_mode_id"] is None


def test_versions_compare_revert_and_duplicate_them(editor_client):
    e, g, s = _emitter(editor_client)
    url = f"/emitters/{e['id']}/operational-modes"
    a = editor_client.post(url, json={"name": "A", "description": "ten"}).json()
    b = editor_client.post(url, json={"name": "B"}).json()
    m = _mode(editor_client, g, s, "M", operational_mode_id=a["id"])
    v1 = editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"}).json()

    # Swap their names, change A's description, move M to B, add C, and save.
    editor_client.patch(f"{url}/{a['id']}", json={"name": "tmp"})
    editor_client.patch(f"{url}/{b['id']}", json={"name": "A"})
    editor_client.patch(f"{url}/{a['id']}", json={"name": "B", "description": "twelve"})
    editor_client.post(url, json={"name": "C"})
    editor_client.patch(f"/ew-groups/{g['id']}/modes/{m['id']}", json={"operational_mode_id": b["id"]})
    v2 = editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v2"}).json()
    diff = editor_client.get(f"/emitters/{e['id']}/versions/{v2['version_number']}/diff").json()["entries"]
    seen = {(d["scope"], d["label"], d["old_value"], d["new_value"]) for d in diff}
    # By id: M left the old A (renamed B since) for the old B (renamed A).
    assert ("Mode 'M'", "Operational mode", "A (now 'B')", "A") in seen
    assert any(d["scope"] == "Operational mode 'C'" and d["kind"] == "added" for d in diff)
    assert any(d["label"] == "Description" and (d["old_value"], d["new_value"]) == ("ten", "twelve") for d in diff)

    # Back to v1: names swapped back, C gone, M on A again.
    r = editor_client.post(f"/emitters/{e['id']}/versions/{v1['version_number']}/revert")
    assert r.status_code == 200, r.text
    rows = {o["id"]: (o["name"], o["description"]) for o in editor_client.get(url).json()}
    assert rows == {a["id"]: ("A", "ten"), b["id"]: ("B", None)}
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


def test_a_tree_track_holds_track_1_2_3(editor_client):
    """TRACK holds Track 1, 2, 3; names are unique among siblings; nothing can
    go under itself; deleting one moves what was under it up."""
    e, g, s = _emitter(editor_client)
    url = f"/emitters/{e['id']}/operational-modes"
    track = editor_client.post(url, json={"name": "TRACK"}).json()
    search = editor_client.post(url, json={"name": "SEARCH"}).json()
    kids = [editor_client.post(url, json={"name": f"Track {i}", "parent_id": track["id"]}).json() for i in (1, 2, 3)]
    assert all(k["parent_id"] == track["id"] for k in kids)
    # The same name under another parent is fine; twice under one isn't.
    assert editor_client.post(url, json={"name": "Track 1", "parent_id": search["id"]}).status_code == 201
    assert editor_client.post(url, json={"name": "Track 1", "parent_id": track["id"]}).status_code == 409
    # Not under itself, nor under one of its own.
    assert editor_client.patch(f"{url}/{track['id']}", json={"parent_id": track["id"]}).status_code == 422
    assert editor_client.patch(f"{url}/{track['id']}", json={"parent_id": kids[0]["id"]}).status_code == 422

    # Modes under Track 1–3, a stagger under Track 3.
    fixed = {**LINE, "pri_min_us": 990, "pri_max_us": 1000}
    m1 = _mode(editor_client, g, s, "T1", operational_mode_id=kids[0]["id"])
    m2 = _mode(editor_client, g, s, "T2", operational_mode_id=kids[1]["id"], line={**fixed, "pri_min_us": 500, "pri_max_us": 500})
    # The RF range they share, set once on TRACK: on every Mode under it.
    r = editor_client.post(f"{url}/{track['id']}/set-values", json={"rf_min_mhz": 9400, "rf_max_mhz": 9450})
    assert r.status_code == 200 and r.json()["count"] == 2, r.text
    lines = {m["name"]: m["line"] for m in editor_client.get(f"/ew-groups/{g['id']}/modes").json()}
    assert (lines["T1"]["rf_min_mhz"], lines["T2"]["rf_max_mhz"]) == (9400, 9450)
    assert (lines["T1"]["pri_max_us"], lines["T2"]["pri_max_us"]) == (1000, 500)  # their own PRI, untouched
    stagger = {k: v for k, v in LINE.items() if not k.startswith(("pri_", "jitter_"))} | {
        "pri_range_matching": False, "pri_stagger_values_us": [300, 400], "frame_time_delta_us": 0}  # fmt: skip
    editor_client.post(
        f"/ew-groups/{g['id']}/modes",
        json={"source_id": s["id"], "name": "T3", "pri_type": "stagger", "line": stagger, "operational_mode_id": kids[2]["id"]},
    )
    # A PRI range doesn't suit the stagger: nothing is set, and it says which.
    r = editor_client.post(f"{url}/{track['id']}/set-values", json={"pri_min_us": 100, "pri_max_us": 100})
    assert r.status_code == 422 and [x["mode_name"] for x in r.json()["detail"]] == ["T3"], r.text
    assert editor_client.post(f"{url}/{track['id']}/set-values", json={}).status_code == 422

    # The planner: Track 2's path named.
    v = editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"}).json()
    p = editor_client.post("/platforms", json={"name": "Tree Platform"}).json()
    editor_client.post(f"/platforms/{p['id']}/links", json={"emitter_id": e["id"], "emitter_version_id": v["id"]})
    [cov] = editor_client.get(f"/platforms/{p['id']}/coverage").json()
    t2 = next(m["planner"] for m in cov["modes"] if m["name"] == "T2")
    assert t2["operational_mode"] == "TRACK › Track 2"

    # Deleting Track 1 moves its Mode up to TRACK.
    assert editor_client.delete(f"{url}/{kids[0]['id']}").status_code == 204
    t1 = next(m for m in editor_client.get(f"/ew-groups/{g['id']}/modes").json() if m["id"] == m1["id"])
    assert t1["operational_mode_id"] == track["id"]
    # Deleting TRACK moves Track 2 and 3 to the top.
    assert editor_client.delete(f"{url}/{track['id']}").status_code == 204
    tops = {o["name"]: o["parent_id"] for o in editor_client.get(url).json()}
    assert tops["Track 2"] is None and tops["Track 3"] is None
    assert m2["operational_mode_id"] == kids[1]["id"]


def test_the_tree_is_versioned_reverted_and_duplicated(editor_client):
    e, _g, _s = _emitter(editor_client)
    url = f"/emitters/{e['id']}/operational-modes"
    track = editor_client.post(url, json={"name": "TRACK"}).json()
    search = editor_client.post(url, json={"name": "SEARCH"}).json()
    t1 = editor_client.post(url, json={"name": "Track 1", "parent_id": track["id"]}).json()
    v1 = editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"}).json()
    editor_client.patch(f"{url}/{t1['id']}", json={"parent_id": search["id"]})
    v2 = editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v2"}).json()
    diff = editor_client.get(f"/emitters/{e['id']}/versions/{v2['version_number']}/diff").json()["entries"]
    assert any(d["label"] == "Under" and (d["old_value"], d["new_value"]) == ("TRACK", "SEARCH") for d in diff)
    assert editor_client.post(f"/emitters/{e['id']}/versions/{v1['version_number']}/revert").status_code == 200
    assert {o["name"]: o["parent_id"] for o in editor_client.get(url).json()}["Track 1"] == track["id"]
    copy = editor_client.post(f"/emitters/{e['id']}/duplicate", json={"new_name": "Tree copy"}).json()
    rows = {o["name"]: o for o in editor_client.get(f"/emitters/{copy['id']}/operational-modes").json()}
    assert rows["Track 1"]["parent_id"] == rows["TRACK"]["id"] != track["id"]


def test_stagger_steps_set_on_every_stagger_under_one(editor_client):
    e, g, s = _emitter(editor_client)
    url = f"/emitters/{e['id']}/operational-modes"
    burst = editor_client.post(url, json={"name": "BURST"}).json()
    stagger = {k: v for k, v in LINE.items() if not k.startswith(("pri_", "jitter_"))} | {
        "pri_range_matching": False, "pri_stagger_values_us": [300, 400], "frame_time_delta_us": 0}  # fmt: skip
    for name in ("B1", "B2"):
        r = editor_client.post(
            f"/ew-groups/{g['id']}/modes",
            json={"source_id": s["id"], "name": name, "pri_type": "stagger", "line": stagger, "operational_mode_id": burst["id"]},
        )
        assert r.status_code == 201, r.text
    r = editor_client.post(f"{url}/{burst['id']}/set-values", json={"pri_stagger_values_us": [300, 350, 400], "frame_time_delta_us": 2})
    assert r.status_code == 200 and r.json()["count"] == 2, r.text
    lines = [m["line"] for m in editor_client.get(f"/ew-groups/{g['id']}/modes").json()]
    assert all(line["pri_stagger_values_us"] == [300, 350, 400] and line["frame_time_delta_us"] == 2 for line in lines)
    # Not on a Fixed one; no step at 0.
    _mode(editor_client, g, s, "F", operational_mode_id=burst["id"])
    r = editor_client.post(f"{url}/{burst['id']}/set-values", json={"pri_stagger_values_us": [300, 400]})
    assert r.status_code == 422 and [x["mode_name"] for x in r.json()["detail"]] == ["F"], r.text
    assert editor_client.post(f"{url}/{burst['id']}/set-values", json={"pri_stagger_values_us": [0, 400]}).status_code == 422


def test_siblings_keep_the_order_they_are_given(editor_client):
    e, _g, _s = _emitter(editor_client)
    url = f"/emitters/{e['id']}/operational-modes"
    track = editor_client.post(url, json={"name": "TRACK"}).json()
    kids = [editor_client.post(url, json={"name": f"Track {i}", "parent_id": track["id"]}).json() for i in (1, 2, 10)]
    # New ones go after their siblings.
    assert [k["sort_order"] for k in kids] == [0, 1, 2]
    order = [kids[2]["id"], kids[0]["id"], kids[1]["id"]]
    r = editor_client.post(f"{url}/order", json={"parent_id": track["id"], "ids": order})
    assert r.status_code == 200, r.text
    rows = sorted((o for o in editor_client.get(url).json() if o["parent_id"] == track["id"]), key=lambda o: o["sort_order"])
    assert [o["name"] for o in rows] == ["Track 10", "Track 1", "Track 2"]
    # Every sibling, each once — not a stale or partial list.
    assert editor_client.post(f"{url}/order", json={"parent_id": track["id"], "ids": order[:2]}).status_code == 422
    log = editor_client.get("/audit-log", params={"entity_type": "operational_mode"}).json()
    entries = log["items"] if isinstance(log, dict) else log
    assert any(x["summary"] == "Reordered the operational modes under 'TRACK'" for x in entries)
