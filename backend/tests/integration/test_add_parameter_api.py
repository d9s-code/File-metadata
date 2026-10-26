"""Adding one parameter value — a stray PRI seen in a test — to every
applicable combination of the other two among the Emitter's Modes."""

LINE = {
    "rf_min_mhz": 9000,
    "rf_max_mhz": 9100,
    "rf_delta": 1,
    "pw_min_us": 0.5,
    "pw_max_us": 1.5,
    "pw_delta": 0,
    "pri_min_us": 995,
    "pri_max_us": 1005,
    "pri_delta": 0,
    "jitter_min_us": 0,
    "jitter_max_us": 1,
    "rf_range_matching": False,
    "pw_range_matching": False,
    "pri_range_matching": False,
}


def _setup(client):
    emitter = client.post("/emitters", json={"name": "Stray PRI Radar"}).json()
    eid = emitter["id"]
    group = client.post(f"/emitters/{eid}/ew-groups", json={"name": "Track"}).json()
    source = client.post(f"/emitters/{eid}/sources", json={"name": "Report", "source_date": "2026-01-01"}).json()

    def mode(name, **line):
        resp = client.post(
            f"/ew-groups/{group['id']}/modes",
            json={"source_id": source["id"], "name": name, "pri_type": "fixed", "line": {**LINE, **line}},
        )
        assert resp.status_code == 201, resp.text
        return resp.json()

    # Two RFs × two PWs, one PRI — and a second PRI on one of the four combinations.
    modes = [
        mode("A1"),
        mode("A2", pw_min_us=2, pw_max_us=2.5),
        mode("B1", rf_min_mhz=9400, rf_max_mhz=9450),
        mode("B2", rf_min_mhz=9400, rf_max_mhz=9450, pw_min_us=2, pw_max_us=2.5),
        mode("A1 other PRI", pri_min_us=1990, pri_max_us=2010),
    ]
    return eid, group, source, modes


STRAY = {"pri_min_us": 1500, "pri_max_us": 1500, "jitter_min_us": 0, "jitter_max_us": 2, "pri_delta": 5}


def test_a_stray_pri_goes_into_every_picked_rf_and_pw(editor_client):
    eid, group, source, modes = _setup(editor_client)
    body = {"parameter": "pri", "pri_type": "fixed", "values": STRAY}
    plan = editor_client.post(f"/emitters/{eid}/modes/add-parameter/plan", json=body)
    assert plan.status_code == 200, plan.text
    rows = plan.json()["rows"]
    # One row per RF × PW combination (the second PRI on A1's doesn't make another).
    assert len(rows) == 4
    a1 = next(r for r in rows if "A1" in r["mode_names"])
    assert sorted(a1["mode_names"]) == ["A1", "A1 other PRI"]
    assert a1["label"].startswith("RF 9000–9100 MHz (±1)") and "PW 0.5–1.5 µs" in a1["label"]
    assert plan.json()["value"] == "PRI 1500 µs, jitter 0–2"

    # Leave one combination out.
    keys = [r["key"] for r in rows if "B2" not in r["mode_names"]]
    resp = editor_client.post(
        f"/emitters/{eid}/modes/add-parameter",
        json={**body, "row_keys": keys, "name_suffix": "PRI 1500"},
    )
    assert resp.status_code == 201, resp.text
    created = {m["name"]: m for m in resp.json()["created"]}
    assert set(created) == {"A1 PRI 1500", "A2 PRI 1500", "B1 PRI 1500"}
    b1 = created["B1 PRI 1500"]["line"]
    assert (b1["rf_min_mhz"], b1["pri_min_us"], b1["pri_delta"], b1["jitter_max_us"]) == (9400, 1500, 5, 2)
    assert created["A2 PRI 1500"]["line"]["pw_min_us"] == 2
    # One generation batch, to delete together.
    batches = editor_client.get(f"/emitters/{eid}/generation-batches").json()
    assert [(b["name_prefix"], b["mode_count"]) for b in batches] == [("PRI 1500", 3)]

    # Again: those combinations have it already, and are skipped.
    plan2 = editor_client.post(f"/emitters/{eid}/modes/add-parameter/plan", json=body).json()["rows"]
    assert sum(r["has_value"] for r in plan2) == 3
    again = editor_client.post(
        f"/emitters/{eid}/modes/add-parameter",
        json={**body, "row_keys": [r["key"] for r in plan2], "name_suffix": "PRI 1500"},
    ).json()
    assert [m["name"] for m in again["created"]] == ["B2 PRI 1500"]
    assert len(again["skipped"]) == 3


def test_a_stagger_and_an_rf_from_a_test_run(editor_client):
    eid, group, source, modes = _setup(editor_client)
    run = editor_client.post(
        f"/emitters/{eid}/test-records",
        json={"test_type": "intercept", "title": "Field day", "received_power_dbfs": -40, "test_date": "2026-09-01", "result": "partial"},
    ).json()
    # A stagger on just A1's combination, derived from the run.
    body = {"parameter": "pri", "pri_type": "stagger", "values": {"pri_stagger_values_us": [700, 750], "frame_time_delta_us": 3}}
    rows = editor_client.post(f"/emitters/{eid}/modes/add-parameter/plan", json=body).json()["rows"]
    key = next(r["key"] for r in rows if "A1" in r["mode_names"])
    resp = editor_client.post(
        f"/emitters/{eid}/modes/add-parameter",
        json={**body, "row_keys": [key], "name_suffix": "Stagger", "derived_from_test_record_id": run["id"]},
    )
    assert resp.status_code == 201, resp.text
    [made] = resp.json()["created"]
    assert made["pri_type"] == "stagger" and made["line"]["pri_stagger_values_us"] == [700, 750]
    assert made["line"]["pri_min_us"] is None and made["line"]["jitter_min_us"] is None
    record = next(r for r in editor_client.get(f"/emitters/{eid}/test-records").json() if r["id"] == run["id"])
    assert [(m["mode_name"], m["link_type"]) for m in record["modes"]] == [("A1 Stagger", "derived")]

    # An RF: combinations of PRI × PW (and PRI type) instead.
    rf = {"parameter": "rf", "values": {"rf_min_mhz": 9600, "rf_max_mhz": 9650, "rf_delta": 2}}
    rows = editor_client.post(f"/emitters/{eid}/modes/add-parameter/plan", json=rf).json()["rows"]
    labels = sorted(r["label"] for r in rows)
    assert any(lbl.startswith("PRI 995–1005 µs") for lbl in labels)
    assert any(lbl.startswith("stagger 700, 750 µs") for lbl in labels)


def test_needs_editing_and_a_valid_value(editor_client, viewer_client):
    eid, group, source, modes = _setup(editor_client)
    body = {"parameter": "pri", "pri_type": "fixed", "values": {"pri_min_us": 1500, "pri_max_us": 1500}}
    rows = editor_client.post(f"/emitters/{eid}/modes/add-parameter/plan", json=body).json()["rows"]
    # Without its jitter and margin, a fixed PRI isn't a valid Mode: none are made.
    bad = editor_client.post(
        f"/emitters/{eid}/modes/add-parameter", json={**body, "row_keys": [rows[0]["key"]], "name_suffix": "X"}
    )
    assert bad.status_code == 422
    assert len(editor_client.get(f"/emitters/{eid}/modes").json()) == 5
    assert viewer_client.post(f"/emitters/{eid}/modes/add-parameter/plan", json=body).status_code == 403


def test_new_modes_can_be_a_name_with_a_running_number(editor_client):
    eid, group, source, modes = _setup(editor_client)
    body = {"parameter": "pri", "pri_type": "fixed", "values": STRAY}
    rows = editor_client.post(f"/emitters/{eid}/modes/add-parameter/plan", json=body).json()["rows"]
    # A Mode already numbered under that name: the new ones carry on after it.
    editor_client.post(
        f"/ew-groups/{group['id']}/modes",
        json={"source_id": source["id"], "name": "Test mode 4", "pri_type": "fixed", "line": {**LINE, "rf_min_mhz": 5000, "rf_max_mhz": 5100}},
    )
    picked = [r["key"] for r in rows if {"A1", "B1"} & set(r["mode_names"])]
    resp = editor_client.post(
        f"/emitters/{eid}/modes/add-parameter", json={**body, "row_keys": picked, "name_base": "Test mode"}
    )
    assert resp.status_code == 201, resp.text
    assert sorted(m["name"] for m in resp.json()["created"]) == ["Test mode 5", "Test mode 6"]
    batches = editor_client.get(f"/emitters/{eid}/generation-batches").json()
    assert [b["name_prefix"] for b in batches] == ["Test mode"]

    # Without either a name or a suffix there's nothing to call them.
    resp = editor_client.post(f"/emitters/{eid}/modes/add-parameter", json={**body, "row_keys": picked})
    assert resp.status_code == 422
