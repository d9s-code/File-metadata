"""Platform confidence (experimental), part 1: what in an MDF's saved version
is unique to one Platform — Emitters, a unique Emitter's Modes (whole
parameter set, and each parameter), pairs of shared Emitters, and Platforms
another one covers."""

LINE = {
    "rf_min_mhz": 9000, "rf_max_mhz": 9100, "rf_delta": 0,
    "pw_min_us": 0.5, "pw_max_us": 1.5, "pw_delta": 0,
    "pri_min_us": 995, "pri_max_us": 1005, "pri_delta": 0,
    "jitter_min_us": 0, "jitter_max_us": 1,
    "rf_range_matching": False, "pw_range_matching": False, "pri_range_matching": False,
}  # fmt: skip


def _emitter(client, name, modes, scan=None):
    """An Emitter with one EW Group (and its scan range) and these Modes
    (name, pri_type, line changes), saved as v1."""
    e = client.post("/emitters", json={"name": name}).json()
    g = client.post(f"/emitters/{e['id']}/ew-groups", json={"name": "G", **({"scan_min": scan[0], "scan_max": scan[1]} if scan else {})}).json()
    s = client.post(f"/emitters/{e['id']}/sources", json={"name": "S", "source_date": "2026-01-01"}).json()
    for mode_name, pri_type, changes in modes:
        line = {**LINE, **changes}
        if pri_type == "stagger":
            line.update(pri_min_us=None, pri_max_us=None, pri_delta=None, jitter_min_us=None, jitter_max_us=None, frame_time_delta_us=2)
        r = client.post(f"/ew-groups/{g['id']}/modes", json={"source_id": s["id"], "name": mode_name, "pri_type": pri_type, "line": line})
        assert r.status_code == 201, r.text
    v = client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"})
    assert v.status_code == 201, v.text
    return {"id": e["id"], "version_id": v.json()["id"], "name": name}


def _platform(client, name, emitters):
    p = client.post("/platforms", json={"name": name}).json()
    for e in emitters:
        r = client.post(f"/platforms/{p['id']}/links", json={"emitter_id": e["id"], "emitter_version_id": e["version_id"]})
        assert r.status_code in (200, 201), r.text
    v = client.post(f"/platforms/{p['id']}/versions", json={"change_summary": "v1"})
    assert v.status_code == 201, v.text
    return {"id": p["id"], "version_id": v.json()["id"], "name": name}


def _mdf(client, name, platforms):
    m = client.post("/mdfs", json={"name": name}).json()
    for p in platforms:
        r = client.post(f"/mdfs/{m['id']}/links", json={"platform_id": p["id"], "platform_version_id": p["version_id"]})
        assert r.status_code == 201, r.text
    assert client.post(f"/mdfs/{m['id']}/versions", json={"change_summary": "v1"}).status_code == 201
    return m


def _setup(client):
    # Frigate: a unique Emitter "Fire Control" — Track (RF 9600–9700, nothing
    # else there: unique set and unique RF) and Search (the same as Corvette's
    # Nav Radar: not unique); Shared A (also on Corvette) and Shared B (also on
    # Tug) — only the Frigate has both.
    fire = _emitter(client, "Fire Control", [
        ("Track", "fixed", {"rf_min_mhz": 9600, "rf_max_mhz": 9700}),
        ("Search", "fixed", {}),
        ("Burst", "stagger", {"pri_stagger_values_us": [500, 600]}),
    ], scan=(10, 12))  # fmt: skip
    nav = _emitter(client, "Nav Radar", [("Nav", "fixed", {})], scan=(1, 2))
    shared_a = _emitter(client, "Shared A", [("A1", "fixed", {"rf_min_mhz": 3000, "rf_max_mhz": 3100})])
    shared_b = _emitter(client, "Shared B", [("B1", "fixed", {"rf_min_mhz": 5000, "rf_max_mhz": 5100})])
    frigate = _platform(client, "Frigate", [fire, shared_a, shared_b])
    corvette = _platform(client, "Corvette", [nav, shared_a])
    tug = _platform(client, "Tug", [shared_b])
    return _mdf(client, "Fleet", [frigate, corvette, tug])


def test_unique_emitters_modes_parameters_and_pairs(editor_client):
    mdf = _setup(editor_client)
    resp = editor_client.get(f"/pcl/mdfs/{mdf['id']}/uniqueness")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["mdf_version_number"] == 1 and body["stagger_step_delta_us"] == 1.0
    platforms = {p["platform_name"]: p for p in body["platforms"]}
    assert list(platforms) == ["Corvette", "Frigate", "Tug"]

    frigate = platforms["Frigate"]
    emitters = {e["emitter_name"]: e for e in frigate["emitters"]}
    assert emitters["Fire Control"]["unique"] is True
    assert [s["platform_name"] for s in emitters["Shared A"]["shared_with"]] == ["Corvette"]
    assert emitters["Shared A"]["modes"] == []  # a shared Emitter's Modes are on the other Platform too

    modes = {m["mode_name"]: m for m in emitters["Fire Control"]["modes"]}
    # Track: no other Platform's Mode near its RF.
    assert modes["Track"]["unique_set"] is True
    assert "rf" in modes["Track"]["unique_params"]
    # Search: Corvette's Nav Radar has the same RF, PW and PRI.
    assert modes["Search"]["unique_set"] is False
    assert modes["Search"]["overlaps"][0] == {
        "platform_id": platforms["Corvette"]["platform_id"],
        "platform_name": "Corvette",
        "emitter_id": modes["Search"]["overlaps"][0]["emitter_id"],
        "emitter_name": "Nav Radar",
        "mode_id": modes["Search"]["overlaps"][0]["mode_id"],
        "mode_name": "Nav",
    }
    assert "rf" not in modes["Search"]["unique_params"]
    # Its scan (10–12 s) is the only one there: a unique parameter all the same.
    assert "scan" in modes["Search"]["unique_params"]
    # Burst: no other Stagger anywhere — a unique set, and PRI unique by type,
    # though its RF and PW are Nav Radar's.
    assert modes["Burst"]["unique_set"] is True
    assert modes["Burst"]["unique_params"] == ["pri", "scan"]
    assert (emitters["Fire Control"]["mode_count"], emitters["Fire Control"]["unique_set_count"]) == (3, 2)

    # Shared A (Frigate + Corvette) and Shared B (Frigate + Tug): only the Frigate has both.
    assert frigate["unique_pair_count"] == 1
    assert {e["emitter_name"] for e in frigate["unique_pairs"][0]["emitters"]} == {"Shared A", "Shared B"}
    assert (frigate["unique_emitter_count"], frigate["unique_set_count"]) == (1, 2)

    # The Tug has only Shared B, which the Frigate has too.
    tug = platforms["Tug"]
    assert tug["unique_emitter_count"] == 0
    assert [c["platform_name"] for c in tug["covered_by"]] == ["Frigate"]
    assert platforms["Frigate"]["covered_by"] == []


def test_needs_a_saved_mdf_version(editor_client):
    m = editor_client.post("/mdfs", json={"name": "Unsaved"}).json()
    resp = editor_client.get(f"/pcl/mdfs/{m['id']}/uniqueness")
    assert resp.status_code == 422
    assert "Save a version" in resp.text


def test_viewers_can_read_it(viewer_client, editor_client):
    mdf = _setup(editor_client)
    assert viewer_client.get(f"/pcl/mdfs/{mdf['id']}/uniqueness").status_code == 200
