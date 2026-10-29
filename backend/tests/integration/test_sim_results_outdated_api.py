"""A SIM Test Line's latest result stops counting once a Mode it involved is
deleted — every Mode replaced by an import, say: it's out of date, not
correct, until the SIM test is run again. Lines that lost their expected Mode
can be re-linked to the Mode of the same name now."""

from tests.integration.test_ambiguity_api import FIXED_LINE


def _setup(client):
    emitter = client.post("/emitters", json={"name": "Replaced Radar"}).json()
    eid = emitter["id"]
    group = client.post(f"/emitters/{eid}/ew-groups", json={"name": "G"}).json()
    source = client.post(f"/emitters/{eid}/sources", json={"name": "S", "source_date": "2026-01-01"}).json()
    modes = f"/ew-groups/{group['id']}/modes"
    one = client.post(modes, json={"source_id": source["id"], "name": "Mode 1", "pri_type": "fixed", "line": FIXED_LINE}).json()
    two = client.post(modes, json={"source_id": source["id"], "name": "Mode 2", "pri_type": "fixed", "line": FIXED_LINE}).json()
    lines = client.post(
        f"/emitters/{eid}/test-lines/import",
        json={"created_date": "2026-08-01", "lines": [{"label": "SIM 1", "expected_mode_id": one["id"]},
                                                      {"label": "SIM 2", "expected_mode_id": two["id"]}]},
    ).json()  # fmt: skip
    client.post(f"/emitters/{eid}/versions", json={"change_summary": "v1"})
    version = client.get(f"/emitters/{eid}/versions").json()[-1]["id"]
    run = client.post(
        f"/emitters/{eid}/test-records",
        json={"test_type": "simulation", "title": "Sim", "received_power_dbfs": -40, "test_date": "2026-09-01",
              "simulation_created_date": "2026-08-01", "emitter_version_id": version,
              "line_results": [{"test_line_id": lines[0]["id"], "outcome": "pass", "intercepted_mode_ids": [one["id"]]},
                               {"test_line_id": lines[1]["id"], "outcome": "pass", "intercepted_mode_ids": [two["id"]]}]},
    )  # fmt: skip
    assert run.status_code == 201, run.text
    return eid, group, source, modes, one, two, lines


def _summary(client, eid):
    return client.get(f"/emitters/{eid}").json()["summary"]


def test_results_against_deleted_modes_are_out_of_date_and_lines_relink_by_name(editor_client):
    eid, group, source, modes, one, two, lines = _setup(editor_client)
    assert (_summary(editor_client, eid)["sim_lines_correct"], _summary(editor_client, eid)["sim_lines_outdated"]) == (2, 0)

    # Every Mode replaced: deleted, and new ones of the same names.
    editor_client.post(f"/emitters/{eid}/checkout")
    for m in (one, two):
        assert editor_client.delete(f"{modes}/{m['id']}").status_code == 204
    new_one = editor_client.post(modes, json={"source_id": source["id"], "name": "Mode 1", "pri_type": "fixed", "line": FIXED_LINE}).json()

    summary = _summary(editor_client, eid)
    assert (summary["sim_lines"], summary["sim_lines_correct"], summary["sim_lines_outdated"]) == (2, 0, 2)
    listed = {tl["label"]: tl for tl in editor_client.get(f"/emitters/{eid}/test-lines").json()}
    assert listed["SIM 1"]["last_test_result"] == "pass"
    assert listed["SIM 1"]["last_result_outdated"] == "Mode 1 was deleted since the run"
    assert listed["SIM 1"]["expected_mode_id"] is None

    sim = next(r for r in editor_client.get("/dashboard/overview").json()["emitter_sim_status"] if r["emitter_id"] == eid)
    assert sim["line_outcomes"]["outdated"] == 2 and sim["line_outcomes"]["pass"] == 0
    attention = editor_client.get("/dashboard/attention").json()["needs_attention"]
    assert any(i["message"].startswith("Emitter 'Replaced Radar': 2 SIM Test Lines' results are out of date") for i in attention)

    # Re-link: SIM 1 finds the new Mode 1; SIM 2's Mode 2 isn't there.
    plan = {r["label"]: r for r in editor_client.get(f"/emitters/{eid}/test-lines/relink-plan").json()}
    assert (plan["SIM 1"]["status"], plan["SIM 1"]["mode_id"], plan["SIM 2"]["status"]) == ("match", new_one["id"], "none")
    resp = editor_client.post(f"/emitters/{eid}/test-lines/relink", json={"test_line_ids": [r["test_line_id"] for r in plan.values()]})
    assert resp.status_code == 200, resp.text
    [relinked] = resp.json()
    assert (relinked["label"], relinked["expected_mode_id"], relinked["expected_mode_name"]) == ("SIM 1", new_one["id"], "Mode 1")
    # Still out of date: the run was against the old Mode 1.
    assert relinked["last_result_outdated"] == "Mode 1 was deleted since the run"
    trail = editor_client.get("/audit-log", params={"emitter_id": eid, "entity_type": "test_line"}).json()["items"]
    assert trail[0]["summary"] == "Re-linked 1 SIM Test Line to the Modes of their old expected Modes' names"

    # A new run against the new Mode counts again.
    run = editor_client.post(
        f"/emitters/{eid}/test-records",
        json={"test_type": "simulation", "title": "Sim again", "received_power_dbfs": -40, "test_date": "2026-10-01",
              "simulation_created_date": "2026-08-01",
              "line_results": [{"test_line_id": relinked["id"], "outcome": "pass", "intercepted_mode_ids": [new_one["id"]]}]},
    )  # fmt: skip
    assert run.status_code == 201, run.text
    summary = _summary(editor_client, eid)
    assert (summary["sim_lines_correct"], summary["sim_lines_outdated"]) == (1, 1)


def test_reverting_back_to_the_modes_makes_the_results_count_again(editor_client):
    eid, group, source, modes, one, two, lines = _setup(editor_client)
    editor_client.post(f"/emitters/{eid}/checkout")
    editor_client.delete(f"{modes}/{one['id']}")
    assert _summary(editor_client, eid)["sim_lines_outdated"] == 1
    assert editor_client.post(f"/emitters/{eid}/discard").status_code == 200
    assert (_summary(editor_client, eid)["sim_lines_correct"], _summary(editor_client, eid)["sim_lines_outdated"]) == (2, 0)
