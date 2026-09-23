from datetime import date

import pytest

from app.core import enums
from app.models import test_record as test_record_models
from tests.integration.test_prs_import_api import CW_LINE, FIXED_LINE


@pytest.fixture()
def sim_emitter(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Sim Emitter"}).json()
    eid = emitter["id"]
    group = editor_client.post(f"/emitters/{eid}/ew-groups", json={"name": "Search"}).json()
    source = editor_client.post(f"/emitters/{eid}/sources", json={"name": "S", "source_date": "2025-01-01"}).json()
    modes = [
        editor_client.post(
            f"/ew-groups/{group['id']}/modes",
            json={"source_id": source["id"], "name": name, "pri_type": pri, "line": line},
        ).json()
        for name, pri, line in [("Search A", "fixed", FIXED_LINE), ("Search B", "cw", CW_LINE)]
    ]
    lines = editor_client.post(
        f"/emitters/{eid}/test-lines/import",
        json={"created_date": "2026-08-01", "lines": [{"label": "SIM 1"}, {"label": "SIM 2"}]},
    ).json()
    return {"id": eid, "modes": modes, "lines": lines}


def _log_run(client, eid, line_results, test_date="2026-09-01", **extra):
    return client.post(
        f"/emitters/{eid}/test-records",
        json={
            "test_type": "simulation",
            "title": f"Run {test_date}",
            "test_date": test_date,
            "simulation_created_date": "2026-08-01",
            "line_results": line_results,
            **extra,
        },
    )


# --- SIM Test Lines: created date and status -------------------------------


def test_import_requires_the_sim_lines_created_date(editor_client, sim_emitter):
    resp = editor_client.post(f"/emitters/{sim_emitter['id']}/test-lines/import", json={"lines": [{"label": "X"}]})
    assert resp.status_code == 422


def test_imported_lines_carry_their_created_date(editor_client, sim_emitter):
    assert {ln["created_date"] for ln in sim_emitter["lines"]} == {"2026-08-01"}
    line = sim_emitter["lines"][0]
    resp = editor_client.patch(
        f"/emitters/{sim_emitter['id']}/test-lines/{line['id']}", json={"created_date": "2026-08-02"}
    )
    assert resp.json()["created_date"] == "2026-08-02"


def test_untested_lines_have_no_status(editor_client, sim_emitter):
    listed = editor_client.get(f"/emitters/{sim_emitter['id']}/test-lines").json()
    assert all(ln["last_test_result"] is None and ln["last_tested_at"] is None for ln in listed)


def test_line_status_comes_from_the_most_recent_run_that_included_it(editor_client, sim_emitter):
    eid, (l1, l2) = sim_emitter["id"], sim_emitter["lines"]
    _log_run(editor_client, eid, [{"test_line_id": l1["id"], "outcome": "fail"}, {"test_line_id": l2["id"], "outcome": "pass"}], "2026-09-01")
    latest = _log_run(editor_client, eid, [{"test_line_id": l1["id"], "outcome": "pass"}], "2026-09-10").json()
    # An older run logged afterwards doesn't override the newer one.
    _log_run(editor_client, eid, [{"test_line_id": l1["id"], "outcome": "partial"}], "2026-08-20")

    by_label = {ln["label"]: ln for ln in editor_client.get(f"/emitters/{eid}/test-lines").json()}
    assert (by_label["SIM 1"]["last_test_result"], by_label["SIM 1"]["last_tested_at"]) == ("pass", "2026-09-10")
    assert by_label["SIM 1"]["last_test_record_id"] == latest["id"]
    # SIM 2 wasn't in the latest run, so it keeps the result from the run that did include it.
    assert (by_label["SIM 2"]["last_test_result"], by_label["SIM 2"]["last_tested_at"]) == ("pass", "2026-09-01")


# --- Intercepted modes and parameters per line -----------------------------


def test_a_line_can_flag_several_intercepted_modes_and_parameters(editor_client, sim_emitter):
    eid, (a, b), (l1, _) = sim_emitter["id"], sim_emitter["modes"], sim_emitter["lines"]
    resp = _log_run(
        editor_client,
        eid,
        [
            {
                "test_line_id": l1["id"],
                "outcome": "partial",
                "intercepted_mode_ids": [a["id"], b["id"], a["id"]],
                "observed_values": [
                    {"rf_min_mhz": 2900, "rf_max_mhz": 3100, "pri_type": "fixed", "pri_min_us": 800, "pri_max_us": 820},
                    {},
                ],
            }
        ],
    )
    assert resp.status_code == 201, resp.text
    line = resp.json()["lines"][0]
    assert sorted(m["mode_name"] for m in line["intercepted_modes"]) == ["Search A", "Search B"]
    assert line["observed_values"] == [
        {"rf_min_mhz": 2900, "rf_max_mhz": 3100, "pri_type": "fixed", "pri_min_us": 800, "pri_max_us": 820}
    ]

    listed = editor_client.get(f"/emitters/{eid}/test-records").json()[0]["lines"][0]
    assert len(listed["intercepted_modes"]) == 2


def test_intercepted_mode_from_another_emitter_is_404(editor_client, sim_emitter):
    other = editor_client.post("/emitters", json={"name": "Other"}).json()
    group = editor_client.post(f"/emitters/{other['id']}/ew-groups", json={"name": "G"}).json()
    source = editor_client.post(f"/emitters/{other['id']}/sources", json={"name": "S", "source_date": "2025-01-01"}).json()
    foreign = editor_client.post(
        f"/ew-groups/{group['id']}/modes",
        json={"source_id": source["id"], "name": "Foreign", "pri_type": "cw", "line": CW_LINE},
    ).json()
    resp = _log_run(
        editor_client,
        sim_emitter["id"],
        [{"test_line_id": sim_emitter["lines"][0]["id"], "outcome": "partial", "intercepted_mode_ids": [foreign["id"]]}],
    )
    assert resp.status_code == 404


def test_contradictory_intercepted_parameters_are_422(editor_client, sim_emitter):
    resp = _log_run(
        editor_client,
        sim_emitter["id"],
        [
            {
                "test_line_id": sim_emitter["lines"][0]["id"],
                "outcome": "pass",
                "observed_values": [{"pri_type": "cw", "pri_min_us": 5}],
            }
        ],
    )
    assert resp.status_code == 422


def test_deleting_an_intercepted_mode_keeps_the_run(editor_client, sim_emitter):
    eid, (a, b), (l1, _) = sim_emitter["id"], sim_emitter["modes"], sim_emitter["lines"]
    _log_run(editor_client, eid, [{"test_line_id": l1["id"], "outcome": "partial", "intercepted_mode_ids": [a["id"], b["id"]]}])
    group_id = a["ew_group_id"]
    assert editor_client.delete(f"/ew-groups/{group_id}/modes/{a['id']}").status_code == 204
    line = editor_client.get(f"/emitters/{eid}/test-records").json()[0]["lines"][0]
    assert [m["mode_name"] for m in line["intercepted_modes"]] == ["Search B"]


# --- Test types ------------------------------------------------------------


@pytest.mark.parametrize("test_type", ["lab_bench", "live_range", "field_exercise"])
def test_only_simulation_and_intercept_tests_can_be_logged(editor_client, sim_emitter, test_type):
    resp = editor_client.post(
        f"/emitters/{sim_emitter['id']}/test-records",
        json={"test_type": test_type, "title": "Old type", "test_date": "2026-09-01", "result": "pass"},
    )
    assert resp.status_code == 422


def test_intercept_test_logs_per_mode_results_with_parameters(editor_client, sim_emitter):
    a = sim_emitter["modes"][0]
    resp = editor_client.post(
        f"/emitters/{sim_emitter['id']}/test-records",
        json={
            "test_type": "intercept",
            "title": "Field intercept",
            "test_date": "2026-09-05",
            "mode_results": [
                {"mode_id": a["id"], "result": "pass", "observed_values": [{"rf_min_mhz": 2950, "rf_max_mhz": 2960}]}
            ],
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["modes"][0]["observed_values"] == [{"rf_min_mhz": 2950, "rf_max_mhz": 2960}]


def test_records_of_retired_types_are_still_listed(editor_client, sim_emitter, db_session):
    db_session.add(
        test_record_models.TestRecord(
            scope_type=enums.TestScopeType.emitter,
            scope_id=sim_emitter["id"],
            test_type=enums.TestType.lab_bench,
            result=enums.TestResult.pass_,
            title="Legacy bench test",
            test_date=date(2025, 5, 1),
        )
    )
    db_session.commit()
    listed = editor_client.get(f"/emitters/{sim_emitter['id']}/test-records").json()
    assert [r["test_type"] for r in listed] == ["lab_bench"]


# --- Versioning ------------------------------------------------------------


def test_created_date_is_versioned_and_restored_by_revert(editor_client, sim_emitter):
    eid, line = sim_emitter["id"], sim_emitter["lines"][0]
    editor_client.post(f"/emitters/{eid}/versions", json={"change_summary": "v1"})
    editor_client.patch(f"/emitters/{eid}/test-lines/{line['id']}", json={"created_date": "2026-08-20"})
    editor_client.post(f"/emitters/{eid}/versions", json={"change_summary": "v2"})

    entries = editor_client.get(f"/emitters/{eid}/versions/2/diff").json()["entries"]
    changed = [e for e in entries if e["label"] == "Created"]
    assert [(e["old_value"], e["new_value"]) for e in changed] == [("2026-08-01", "2026-08-20")]

    assert editor_client.post(f"/emitters/{eid}/versions/1/revert").status_code in (200, 201)
    restored = next(ln for ln in editor_client.get(f"/emitters/{eid}/test-lines").json() if ln["id"] == line["id"])
    assert restored["created_date"] == "2026-08-01"


def test_intercepted_parameters_are_logged_as_means(editor_client, sim_emitter):
    eid, (l1, l2) = sim_emitter["id"], sim_emitter["lines"]
    fixed = {"rf_mean_mhz": 2950.5, "pri_type": "fixed", "pri_mean_us": 810, "jitter_mean_us": 4, "pw_mean_us": 0.8}
    stagger = {"rf_mean_mhz": 3000, "pri_type": "stagger", "pri_stagger_values_us": [100, 150], "frame_time_us": 250, "pw_mean_us": 1}
    resp = _log_run(
        editor_client,
        eid,
        [
            {"test_line_id": l1["id"], "outcome": "pass", "observed_values": [fixed]},
            {"test_line_id": l2["id"], "outcome": "pass", "observed_values": [stagger]},
        ],
    )
    assert resp.status_code == 201, resp.text
    by_label = {line["test_line_label"]: line["observed_values"] for line in resp.json()["lines"]}
    assert by_label[l1["label"]] == [fixed]
    assert by_label[l2["label"]] == [stagger]


@pytest.mark.parametrize(
    "bad",
    [
        {"pri_type": "stagger", "pri_mean_us": 800},
        {"pri_type": "cw", "jitter_mean_us": 3},
        {"pri_mean_us": 800},
        {"pri_type": "stagger", "pri_stagger_values_us": [100, 150], "jitter_mean_us": 2},
    ],
)
def test_pri_and_jitter_means_are_fixed_only(editor_client, sim_emitter, bad):
    resp = _log_run(
        editor_client,
        sim_emitter["id"],
        [{"test_line_id": sim_emitter["lines"][0]["id"], "outcome": "pass", "observed_values": [bad]}],
    )
    assert resp.status_code == 422
