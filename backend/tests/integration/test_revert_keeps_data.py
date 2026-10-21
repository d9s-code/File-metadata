"""Reverting (and discarding) must never lose data: whatever a revert removes
comes back, as it was, when a later revert or discard brings it back — and
what isn't part of a version (test results, notes, generation logs, links
from Intercepts) is kept throughout."""

from app.models.cartesian_run import CartesianRun
from app.models.emitter_version import EmitterVersion
from app.models.mode import ModeGenerationBatch
from app.models.parameter_sequence import ParameterSequence
from app.models.source_note import SourceNote

LINE = {
    "rf_min_mhz": 2900,
    "rf_max_mhz": 3100,
    "pw_min_us": 0.5,
    "pw_max_us": 1.2,
    "pri_min_us": 800,
    "pri_max_us": 1200,
    "jitter_min_us": 5,
    "jitter_max_us": 15,
    "rf_delta": 1,
    "pw_delta": 0.05,
    "pri_delta": 10,
    "rf_range_matching": False,
    "pw_range_matching": False,
    "pri_range_matching": False,
}

SEQUENCE = {
    "label": "Hop table",
    "variant": "typical",
    "steps": [{"order": 0, "rf_mhz": 9500, "pri_us": 800, "dwell_s": 0.1}, {"order": 1, "rf_mhz": 9520}],
    "rf_delta": 2,
}


def _commit(client, eid, summary):
    resp = client.post(f"/emitters/{eid}/versions", json={"change_summary": summary})
    assert resp.status_code == 201, resp.text
    return resp.json()["version_number"]


def _revert(client, eid, number):
    resp = client.post(f"/emitters/{eid}/versions/{number}/revert")
    assert resp.status_code == 200, resp.text


def _build(client, admin_client):
    """An Emitter whose v1 has only an EW Group, and whose v2 adds a Source
    with everything that can hang off one: Elements with their variant,
    margin and details, a sequence, a note, a cartesian run (a generation
    batch and its log), a Mode made from an Intercept entry, a SIM line, and
    logged runs of both kinds naming the Modes."""
    source_group = admin_client.post("/source-groups/", json={"name": "Revert Group"}).json()
    emitter = client.post("/emitters", json={"name": "Keep Everything"}).json()
    eid = emitter["id"]
    group = client.post(f"/emitters/{eid}/ew-groups", json={"name": "Track"}).json()
    _commit(client, eid, "v1: the EW Group alone")

    client.patch(f"/emitters/{eid}/ew-groups/{group['id']}", json={"scan_min": 2, "scan_max": 4, "scan_delta": 0.5})
    source = client.post(
        f"/emitters/{eid}/sources",
        json={
            "name": "Report 7",
            "source_date": "2026-01-01",
            "source_type": "ELINT report",
            "rf_legacy_term": "Band X",
            "pri_legacy_term": "PRF hi",
            "group_id": source_group["id"],
        },
    ).json()
    sid = source["id"]
    base = f"/emitters/{eid}/sources/{sid}"
    rf = client.post(
        f"{base}/elements",
        json={"element_type": "rf", "variant": "extreme", "value_min": 9000, "value_max": 9100, "delta": 3,
              "details": "from table 4"},
    ).json()
    pri = client.post(
        f"{base}/elements", json={"element_type": "pri", "value_min": 800, "value_max": 800, "jitter_min": 0, "jitter_max": 1}
    ).json()
    pw = client.post(f"{base}/elements", json={"element_type": "pw", "value_min": 1, "value_max": 1}).json()
    assert client.post(f"{base}/parameter-sequences", json=SEQUENCE).status_code == 201
    assert client.post(f"{base}/notes", json={"body": "Checked against the original"}).status_code == 201
    product = client.post(
        f"{base}/elements/cartesian-product",
        json={"ew_group_id": group["id"], "rf_element_ids": [rf["id"]], "pri_element_ids": [pri["id"]],
              "pw_element_ids": [pw["id"]], "name_prefix": "Gen"},
    )
    assert product.status_code == 200, product.text

    intercept = client.post("/intercepts", json={"emitter_id": eid, "name": "Pass 1"}).json()
    entry = client.post(
        f"/intercepts/{intercept['id']}/entries",
        json={"pri_type": "fixed", "rf_mean_mhz": 3000, "pw_mean_us": 1.0, "pri_mean_us": 1000, "jitter_mean_us": 10},
    ).json()
    derived = client.post(
        f"/ew-groups/{group['id']}/modes",
        json={"source_id": sid, "name": "From Intercept", "pri_type": "fixed", "line": LINE,
              "derived_from_intercept_entry_ids": [entry["id"]]},
    ).json()
    line = client.post(
        f"/emitters/{eid}/test-lines/import",
        json={"created_date": "2026-08-01", "batch_label": "Batch A",
              "lines": [{"label": "SIM 1", "expected_mode_id": derived["id"]}]},
    ).json()[0]
    v2 = _commit(client, eid, "v2: a Source with everything")

    intercept_run = client.post(
        f"/emitters/{eid}/test-records",
        json={"test_type": "intercept", "title": "Live", "test_date": "2026-09-01",
              "mode_results": [{"mode_id": derived["id"], "result": "partial", "notes": "weak",
                                "observed_values": [{"rf_mean_mhz": 3001, "received_power_dbfs": -42}]}],
              "signals": [{"observed_values": [{"rf_mean_mhz": 9410, "received_power_dbfs": -42}], "notes": "burst"}]},
    )
    assert intercept_run.status_code == 201, intercept_run.text
    sim_run = client.post(
        f"/emitters/{eid}/test-records",
        json={"test_type": "simulation", "title": "Sim", "test_date": "2026-09-02",
              "simulation_created_date": "2026-08-01",
              "line_results": [{"test_line_id": line["id"], "outcome": "fail",
                                "intercepted_mode_ids": [derived["id"]], "notes": "wrong Mode"}]},
    )
    assert sim_run.status_code == 201, sim_run.text
    return {"eid": eid, "group": group, "sid": sid, "intercept": intercept, "entry": entry, "derived": derived,
            "v2": v2, "source_group": source_group}


def _state(client, ctx) -> dict:
    """Everything a revert could touch, as the API shows it."""
    eid, sid = ctx["eid"], ctx["sid"]
    base = f"/emitters/{eid}/sources/{sid}"
    sources = client.get(f"/emitters/{eid}/sources").json()

    def drop(rows, *keys):
        return [{k: v for k, v in r.items() if k not in keys} for r in rows]

    return {
        "sources": drop(sources, "created_at", "updated_at"),
        "elements": client.get(f"{base}/elements").json() if sources else None,
        "sequences": drop(client.get(f"{base}/parameter-sequences").json(), "created_at") if sources else None,
        "notes": client.get(f"{base}/notes").json() if sources else None,
        "runs": client.get(f"{base}/cartesian-runs").json() if sources else None,
        "groups": drop(client.get(f"/emitters/{eid}/ew-groups").json(), "created_at", "updated_at"),
        # A Mode's line is a row of its own, made again when the Mode comes
        # back; nothing refers to it but the Mode, so its id doesn't matter.
        "modes": [
            {**m, "line": {k: v for k, v in m["line"].items() if k not in ("id", "created_at")}}
            for m in drop(client.get(f"/emitters/{eid}/modes").json(), "created_at", "updated_at")
        ],
        "batches": client.get(f"/emitters/{eid}/generation-batches").json(),
        "test_lines": drop(client.get(f"/emitters/{eid}/test-lines").json(), "created_at", "updated_at"),
        "records": client.get(f"/emitters/{eid}/test-records").json(),
        "entries": client.get(f"/intercepts/{ctx['intercept']['id']}/entries").json(),
    }


def test_reverting_away_and_back_brings_everything_back_as_it_was(editor_client, admin_client):
    ctx = _build(editor_client, admin_client)
    before = _state(editor_client, ctx)
    assert before["sequences"] and before["notes"] and before["runs"] and before["batches"]
    assert before["entries"][0]["derived_mode_ids"] == [ctx["derived"]["id"]]

    _revert(editor_client, ctx["eid"], 1)
    away = _state(editor_client, ctx)
    assert away["sources"] == [] and away["modes"] == [] and away["test_lines"] == []
    # What isn't part of a version is kept meanwhile: the runs keep every result.
    assert len(away["records"]) == 2
    for was, now in zip(before["records"], away["records"]):
        assert [m["result"] for m in now["modes"]] == [m["result"] for m in was["modes"]]
        assert [m["mode_name"] for m in now["modes"]] == [m["mode_name"] for m in was["modes"]]
        assert all(m["mode_exists"] is False for m in now["modes"])
        assert [(ln["test_line_label"], ln["outcome"], ln["notes"]) for ln in now["lines"]] == [
            (ln["test_line_label"], ln["outcome"], ln["notes"]) for ln in was["lines"]
        ]
        assert now["signals"] == was["signals"]
    # The Intercept entry doesn't point at a Mode that isn't there.
    assert away["entries"][0]["derived_mode_ids"] == []

    _revert(editor_client, ctx["eid"], ctx["v2"])
    assert _state(editor_client, ctx) == before


def test_reverting_back_and_forth_twice_loses_nothing(editor_client, admin_client):
    ctx = _build(editor_client, admin_client)
    before = _state(editor_client, ctx)
    for _ in range(2):
        _revert(editor_client, ctx["eid"], 1)
        _revert(editor_client, ctx["eid"], ctx["v2"])
    assert _state(editor_client, ctx) == before


def test_discarding_a_deleted_source_brings_back_its_notes_sequences_and_log(editor_client, admin_client):
    ctx = _build(editor_client, admin_client)
    eid = ctx["eid"]
    before = _state(editor_client, ctx)
    for mode in editor_client.get(f"/emitters/{eid}/modes").json():
        assert editor_client.delete(f"/ew-groups/{mode['ew_group_id']}/modes/{mode['id']}").status_code == 204
    assert editor_client.delete(f"/emitters/{eid}/sources/{ctx['sid']}").status_code == 204
    assert editor_client.get(f"/emitters/{eid}/sources").json() == []

    assert editor_client.post(f"/emitters/{eid}/discard").status_code == 200
    assert _state(editor_client, ctx) == before


def test_discard_undoes_sequence_and_element_edits(editor_client, admin_client):
    ctx = _build(editor_client, admin_client)
    eid, sid = ctx["eid"], ctx["sid"]
    base = f"/emitters/{eid}/sources/{sid}"
    before = _state(editor_client, ctx)
    sequence = editor_client.get(f"{base}/parameter-sequences").json()[0]
    editor_client.patch(f"{base}/parameter-sequences/{sequence['id']}", json={"label": "Renamed"})
    editor_client.post(f"{base}/parameter-sequences", json={**SEQUENCE, "label": "Second"})
    editor_client.patch(f"/emitters/{eid}/ew-groups/{ctx['group']['id']}", json={"scan_delta": 1.5})

    diff = editor_client.get(f"/emitters/{eid}/diff/live").json()["entries"]
    assert any(e["label"] == "Sequences" for e in diff)
    assert any(e["label"] == "Scan Delta" for e in diff)

    assert editor_client.post(f"/emitters/{eid}/discard").status_code == 200
    assert _state(editor_client, ctx) == before


def test_a_renamed_mode_keeps_its_results_under_its_name_now(editor_client, admin_client):
    ctx = _build(editor_client, admin_client)
    eid, mode = ctx["eid"], ctx["derived"]
    editor_client.patch(f"/ew-groups/{mode['ew_group_id']}/modes/{mode['id']}", json={"name": "Renamed"})
    v3 = _commit(editor_client, eid, "v3: renamed")
    _revert(editor_client, eid, ctx["v2"])
    names = {m["mode_name"] for r in editor_client.get(f"/emitters/{eid}/test-records").json() for m in r["modes"]}
    assert names == {"From Intercept"}
    _revert(editor_client, eid, 1)
    _revert(editor_client, eid, v3)
    records = editor_client.get(f"/emitters/{eid}/test-records").json()
    assert {m["mode_name"] for r in records for m in r["modes"]} == {"Renamed"}
    assert {m["mode_exists"] for r in records for m in r["modes"]} == {True}


def test_a_deleted_and_reimported_sim_line_keeps_the_old_runs_results(editor_client, admin_client):
    ctx = _build(editor_client, admin_client)
    eid = ctx["eid"]
    line = editor_client.get(f"/emitters/{eid}/test-lines").json()[0]
    assert editor_client.delete(f"/emitters/{eid}/test-lines/{line['id']}").status_code == 204
    editor_client.post(
        f"/emitters/{eid}/test-lines/import", json={"created_date": "2026-08-01", "lines": [{"label": "SIM 1"}]}
    )
    v3 = _commit(editor_client, eid, "v3: line re-imported")
    sim = next(r for r in editor_client.get(f"/emitters/{eid}/test-records").json() if r["title"] == "Sim")
    assert [(ln["test_line_id"], ln["test_line_label"], ln["outcome"]) for ln in sim["lines"]] == [
        (line["id"], "SIM 1", "fail")
    ]
    # Back to the version with the original line, and forward again: still there.
    _revert(editor_client, eid, ctx["v2"])
    _revert(editor_client, eid, v3)
    sim = next(r for r in editor_client.get(f"/emitters/{eid}/test-records").json() if r["title"] == "Sim")
    assert sim["lines"][0]["notes"] == "wrong Mode"


def test_a_fork_copies_sequences_element_details_and_margins(editor_client, admin_client):
    ctx = _build(editor_client, admin_client)
    resp = editor_client.post(f"/emitters/{ctx['eid']}/versions/{ctx['v2']}/fork", json={"new_name": "Forked"})
    assert resp.status_code == 201, resp.text
    fid = resp.json()["id"]
    source = editor_client.get(f"/emitters/{fid}/sources").json()[0]
    assert (source["rf_legacy_term"], source["pri_legacy_term"], source["group_id"]) == (
        "Band X", "PRF hi", ctx["source_group"]["id"]
    )
    rf = next(e for e in editor_client.get(f"/emitters/{fid}/sources/{source['id']}/elements").json()
              if e["element_type"] == "rf")
    assert (rf["variant"], rf["delta"], rf["details"]) == ("extreme", 3, "from table 4")
    sequences = editor_client.get(f"/emitters/{fid}/sources/{source['id']}/parameter-sequences").json()
    assert [(q["label"], q["rf_delta"], len(q["steps"])) for q in sequences] == [("Hop table", 2, 2)]
    assert editor_client.get(f"/emitters/{fid}/ew-groups").json()[0]["scan_delta"] == 0.5


def test_a_version_saved_before_snapshots_kept_sequences_still_gets_them_back(editor_client, admin_client, db_session):
    ctx = _build(editor_client, admin_client)
    before = _state(editor_client, ctx)
    # As an older version would have been saved: none of the newer keys.
    version = (
        db_session.query(EmitterVersion)
        .filter(EmitterVersion.emitter_id == ctx["eid"], EmitterVersion.version_number == ctx["v2"])
        .one()
    )
    snap = dict(version.snapshot)
    for s in snap["sources"]:
        for key in ("parameter_sequences", "rf_legacy_term", "pri_legacy_term", "group_id", "import_batch_id"):
            s.pop(key)
    version.snapshot = snap
    db_session.commit()

    _revert(editor_client, ctx["eid"], 1)
    _revert(editor_client, ctx["eid"], ctx["v2"])
    after = _state(editor_client, ctx)
    assert after["sequences"] == before["sequences"]
    assert after["notes"] == before["notes"]
    assert after["runs"] == before["runs"]
    assert after["records"] == before["records"]


def test_purging_an_emitter_removes_what_was_kept_for_its_sources(editor_client, admin_client, db_session):
    ctx = _build(editor_client, admin_client)
    eid = ctx["eid"]
    _revert(editor_client, eid, 1)  # the Source's notes etc. now wait for it to come back
    editor_client.delete(f"/emitters/{eid}/checkout")
    assert editor_client.delete(f"/emitters/{eid}").status_code == 204
    assert admin_client.delete(f"/trash/emitter/{eid}").status_code == 204
    db_session.expire_all()
    for model in (SourceNote, ParameterSequence, CartesianRun, ModeGenerationBatch):
        assert db_session.query(model).filter(model.source_id == ctx["sid"]).count() == 0


def test_a_revert_preview_says_what_it_removes_and_what_it_throws_away(editor_client, admin_client):
    ctx = _build(editor_client, admin_client)
    eid = ctx["eid"]
    preview = editor_client.get(f"/emitters/{eid}/versions/1/revert-preview")
    assert preview.status_code == 200, preview.text
    body = preview.json()
    removed = {e["scope"] for e in body["entries"] if e["kind"] == "removed"}
    assert "Mode 'From Intercept'" in removed and "Source 'Report 7'" in removed and "Test Line 'SIM 1'" in removed
    # The intercept run's Mode result, the SIM run's line result and the Mode it intercepted.
    assert body["results_naming_removed"] == 3
    assert body["unsaved_changes"] == 0
    before = editor_client.get(f"/emitters/{eid}/modes").json()

    editor_client.patch(f"/emitters/{eid}", json={"description": "not saved"})
    assert editor_client.get(f"/emitters/{eid}/versions/1/revert-preview").json()["unsaved_changes"] == 1
    # A preview changes nothing.
    assert editor_client.get(f"/emitters/{eid}/modes").json() == before
    assert editor_client.get(f"/emitters/{eid}/versions/{ctx['v2']}/revert-preview").json()["entries"] == [
        e for e in editor_client.get(f"/emitters/{eid}/versions/{ctx['v2']}/revert-preview").json()["entries"]
        if e["label"] == "Description"
    ]
