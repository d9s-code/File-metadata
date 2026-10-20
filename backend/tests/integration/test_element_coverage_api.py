"""Element coverage: which of the Elements in an Emitter's Sources its Modes
(and, for scan, its EW Groups) cover — fully, partly or not at all."""


def _setup(client):
    emitter = client.post("/emitters", json={"name": "Coverage Radar"}).json()
    eid = emitter["id"]
    group = client.post(f"/emitters/{eid}/ew-groups", json={"name": "Search", "scan_min": 2, "scan_max": 4}).json()
    source = client.post(f"/emitters/{eid}/sources", json={"name": "Report", "source_date": "2026-01-01"}).json()
    base = f"/emitters/{eid}/sources/{source['id']}/elements"

    def element(**body):
        resp = client.post(base, json=body)
        assert resp.status_code == 201, resp.text

    element(element_type="rf", value_min=9000, value_max=9100)  # inside the Mode's 8999–9101
    element(element_type="rf", value_min=9050, value_max=9300)  # runs past it
    element(element_type="rf", value_min=9500, value_max=9500)  # nowhere near
    element(element_type="pri", value_min=1000, value_max=1000, jitter_min=0, jitter_max=1)  # the fixed Mode's PRI
    element(element_type="pri", value_min=1200, value_max=1200, jitter_min=0, jitter_max=1)  # a stagger step
    element(element_type="pri", stagger_values=[750, 1200, 700], delta=5)  # the Stagger Mode's, from its 2nd step
    element(element_type="pri", stagger_values=[750, 700, 1200], delta=5)  # its steps, in another order
    element(element_type="pri", stagger_values=[700, 750], delta=5)  # two of its three steps
    element(element_type="pri", stagger_values=[700, 999], delta=5)  # one of them
    element(element_type="pw", value_min=1, value_max=1)
    element(element_type="scan", value_min=3, value_max=3)  # in the EW Group's 2–4 s
    element(element_type="scan", value_min=10, value_max=10)

    line = {"rf_min_mhz": 9000, "rf_max_mhz": 9100, "rf_delta": 1, "pw_min_us": 0.5, "pw_max_us": 1.5, "pw_delta": 0,
            "rf_range_matching": False, "pw_range_matching": False, "pri_range_matching": False}
    fixed = client.post(
        f"/ew-groups/{group['id']}/modes",
        json={"source_id": source["id"], "name": "Track", "pri_type": "fixed",
              "line": {**line, "pri_min_us": 995, "pri_max_us": 1005, "pri_delta": 0, "jitter_min_us": 0, "jitter_max_us": 1}},
    )
    assert fixed.status_code == 201, fixed.text
    stagger = client.post(
        f"/ew-groups/{group['id']}/modes",
        json={"source_id": source["id"], "name": "Hop", "pri_type": "stagger",
              "line": {**line, "pri_stagger_values_us": [700, 750, 1200], "frame_time_delta_us": 5}},
    )
    assert stagger.status_code == 201, stagger.text

    seqs = f"/emitters/{eid}/sources/{source['id']}/parameter-sequences"

    def sequence(label, steps):
        resp = client.post(seqs, json={"label": label, "steps": [{"order": i, **st} for i, st in enumerate(steps)]})
        assert resp.status_code == 201, resp.text

    # PRI steps make a stagger train, a range at its mean, in step order.
    sequence("Same train", [{"pri_us": 700, "rf_mhz": 9050}, {"pri_min_us": 740, "pri_max_us": 760}, {"pri_us": 1200}])
    sequence("Reversed", [{"pri_us": 1200}, {"pri_us": 750}, {"pri_us": 700}])
    sequence("Right train, wrong RF", [{"pri_us": 700, "rf_mhz": 9600}, {"pri_us": 750}, {"pri_us": 1200}])
    # No PRI: each step's RF on its own.
    sequence("RF hops", [{"rf_mhz": 9010}, {"rf_mhz": 9090}, {"rf_mhz": 9700}])
    return eid


def _value(row):
    return tuple(row["stagger_values"]) if row["stagger_values"] else (row["value_min"], row["value_max"])


def test_each_element_is_covered_partly_covered_or_not(editor_client):
    eid = _setup(editor_client)
    resp = editor_client.get(f"/emitters/{eid}/element-coverage")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    got = {(r["element_type"], _value(r)): r for r in body["elements"]}

    def status(kind, value):
        return got[(kind, value)]["coverage"]

    assert status("rf", (9000, 9100)) == "covered"
    assert status("rf", (9050, 9300)) == "partial"
    assert status("rf", (9500, 9500)) == "not_covered"
    assert status("pri", (1000, 1000)) == "covered"
    assert status("pri", (1200, 1200)) == "covered"  # a step of the Stagger Mode
    assert status("pri", (750, 1200, 700)) == "covered"  # a train repeats: any starting step
    assert status("pri", (750, 700, 1200)) == "partial"
    assert "another order" in got[("pri", (750, 700, 1200))]["note"]
    assert status("pri", (700, 750)) == "partial"
    assert "among its 3 steps" in got[("pri", (700, 750))]["note"]
    assert status("pri", (700, 999)) == "partial"
    assert got[("pri", (700, 999))]["note"] == "Hop has 1 of its 2 steps"
    assert status("pw", (1, 1)) == "covered"
    assert status("scan", (3, 3)) == "covered"
    assert status("scan", (10, 10)) == "not_covered"

    assert {c["name"] for c in got[("rf", (9000, 9100))]["covered_by"]} == {"Track", "Hop"}
    assert [(c["name"], c["kind"]) for c in got[("pri", (1200, 1200))]["covered_by"]] == [("Hop", "mode")]
    assert got[("scan", (3, 3))]["covered_by"][0]["kind"] == "ew_group"
    assert body["summary"]["rf"] == {"covered": 1, "partial": 2, "not_covered": 1}

    seq = {r["sequence"]["label"]: r for r in body["elements"] if r["sequence"]}
    assert seq["Same train"]["stagger_values"] == [700, 750, 1200]
    assert (seq["Same train"]["coverage"], seq["Same train"]["covered_by"][0]["name"]) == ("covered", "Hop")
    assert seq["Reversed"]["coverage"] == "partial"
    right = seq["Right train, wrong RF"]
    assert right["coverage"] == "partial" and "RF" in right["note"]
    hops = seq["RF hops"]
    assert (hops["element_type"], hops["coverage"], hops["note"]) == ("rf", "partial", "2 of its 3 steps are covered")

    # The ranges drawn behind the Elements: each Mode's with its margin, a Stagger Mode's steps.
    rf = {r["name"]: (r["min"], r["max"]) for r in body["ranges"]["rf"]}
    assert rf["Track"] == (8999, 9101)
    assert sorted(r["min"] for r in body["ranges"]["pri"] if r.get("step")) == [700, 750, 1200]


def test_an_emitter_with_no_modes_covers_nothing(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Bare"}).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "S", "source_date": "2026-01-01"}
    ).json()
    editor_client.post(
        f"/emitters/{emitter['id']}/sources/{source['id']}/elements",
        json={"element_type": "rf", "value_min": 3000, "value_max": 3000},
    )
    body = editor_client.get(f"/emitters/{emitter['id']}/element-coverage").json()
    assert [r["coverage"] for r in body["elements"]] == ["not_covered"]
    assert body["ranges"] == {"rf": [], "pri": [], "pw": [], "scan": []}
