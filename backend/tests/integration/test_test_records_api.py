import pytest

FIXED_LINE = {
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


@pytest.fixture()
def emitter_with_mode(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Test Record Emitter"}).json()
    ew_group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Group A"}).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Source A", "source_date": "2025-01-01"}
    ).json()
    mode = editor_client.post(
        f"/ew-groups/{ew_group['id']}/modes",
        json={"source_id": source["id"], "name": "Mode 1", "pri_type": "fixed", "line": FIXED_LINE},
    ).json()
    return {"emitter": emitter, "mode": mode}


def test_create_test_record_links_modes(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    mode_id = emitter_with_mode["mode"]["id"]
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "intercept",
            "title": "Bench run",
            "test_date": "2026-01-01",
            "mode_results": [{"mode_id": mode_id, "result": "pass"}],
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert len(body["modes"]) == 1
    assert body["modes"][0]["mode_id"] == mode_id
    assert body["modes"][0]["mode_name"] == "Mode 1"


def test_list_test_records_includes_linked_mode_names(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    mode_id = emitter_with_mode["mode"]["id"]
    editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "intercept",
            "title": "Sim run",
            "test_date": "2026-01-02",
            "mode_results": [{"mode_id": mode_id, "result": "pass"}],
        },
    )
    resp = editor_client.get(f"/emitters/{emitter_id}/test-records")
    assert resp.status_code == 200, resp.text
    [record] = resp.json()
    [linked_mode] = record["modes"]
    assert linked_mode["mode_id"] == mode_id
    assert linked_mode["mode_name"] == "Mode 1"
    assert linked_mode["result"] == "pass"


def test_create_test_record_rejects_unknown_mode_id(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "intercept",
            "title": "Sim run",
            "test_date": "2026-01-02",
            "mode_results": [{"mode_id": "00000000-0000-0000-0000-000000000000", "result": "pass"}],
        },
    )
    assert resp.status_code == 404


def test_deleting_a_test_linked_mode_does_not_block_deletion(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    mode = emitter_with_mode["mode"]
    editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "intercept",
            "title": "Bench run",
            "test_date": "2026-01-01",
            "mode_results": [{"mode_id": mode["id"], "result": "pass"}],
        },
    )
    resp = editor_client.delete(f"/ew-groups/{mode['ew_group_id']}/modes/{mode['id']}")
    assert resp.status_code == 204, resp.text

    # The test record survives, just with that Mode dropped from its list.
    [record] = editor_client.get(f"/emitters/{emitter_id}/test-records").json()
    assert record["modes"] == []


def test_create_test_record_without_modes_still_works(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={"test_type": "intercept", "result": "fail", "title": "Field run", "test_date": "2026-01-03"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["modes"] == []


def test_simulation_test_requires_simulation_created_date(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={"test_type": "simulation", "result": "pass", "title": "Sim run", "test_date": "2026-01-02"},
    )
    assert resp.status_code == 422


def test_simulation_test_succeeds_with_simulation_created_date(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "simulation",
            "result": "pass",
            "title": "Sim run",
            "test_date": "2026-01-02",
            "simulation_created_date": "2025-12-01",
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["simulation_created_date"] == "2025-12-01"


def test_non_simulation_test_does_not_require_simulation_created_date(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={"test_type": "intercept", "result": "pass", "title": "Bench run", "test_date": "2026-01-02"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["simulation_created_date"] is None


def test_emitter_modes_list_carries_last_test_status(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    mode_id = emitter_with_mode["mode"]["id"]

    [mode_before] = editor_client.get(f"/emitters/{emitter_id}/modes").json()
    assert mode_before["last_tested_at"] is None
    assert mode_before["last_test_result"] is None

    editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "intercept",
            "title": "Bench run",
            "test_date": "2026-01-05",
            "mode_results": [{"mode_id": mode_id, "result": "partial"}],
        },
    )
    [mode_after] = editor_client.get(f"/emitters/{emitter_id}/modes").json()
    assert mode_after["last_tested_at"] == "2026-01-05"
    assert mode_after["last_test_result"] == "partial"

    # A later test replaces the "last" status.
    editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={
            "test_type": "intercept",
            "title": "Second bench run",
            "test_date": "2026-01-10",
            "mode_results": [{"mode_id": mode_id, "result": "fail"}],
        },
    )
    [mode_latest] = editor_client.get(f"/emitters/{emitter_id}/modes").json()
    assert mode_latest["last_tested_at"] == "2026-01-10"
    assert mode_latest["last_test_result"] == "fail"


def test_a_mode_reported_for_a_sim_line_counts_as_last_seen(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    mode_id = emitter_with_mode["mode"]["id"]
    lines = editor_client.post(
        f"/emitters/{emitter_id}/test-lines/import",
        json={"lines": [{"label": "A"}, {"label": "B"}], "created_date": "2026-09-01"},
    ).json()

    def sim_run(test_date, outcomes):
        resp = editor_client.post(
            f"/emitters/{emitter_id}/test-records",
            json={
                "test_type": "simulation",
                "title": f"Sim {test_date}",
                "test_date": test_date,
                "simulation_created_date": "2026-09-01",
                "line_results": [
                    {"test_line_id": line["id"], "outcome": o, "intercepted_mode_ids": [mode_id]}
                    for line, o in zip(lines, outcomes)
                ],
            },
        )
        assert resp.status_code == 201, resp.text
        return resp.json()["id"]

    first = sim_run("2026-10-01", ["pass", "pass"])
    [mode] = editor_client.get(f"/emitters/{emitter_id}/modes").json()
    assert (mode["last_tested_at"], mode["last_test_result"], mode["last_test_record_id"]) == ("2026-10-01", "pass", first)
    assert mode["seen_counts"] == {"pass": 1}

    # Reported for two lines in one run, one partial: the run counts as partial.
    second = sim_run("2026-10-05", ["pass", "partial"])
    # An intercept run dated earlier doesn't take over "last seen", but counts.
    editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={"test_type": "intercept", "title": "Field", "test_date": "2026-09-20", "mode_results": [{"mode_id": mode_id, "result": "pass"}]},
    )
    [mode] = editor_client.get(f"/emitters/{emitter_id}/modes").json()
    assert (mode["last_tested_at"], mode["last_test_result"], mode["last_test_record_id"]) == ("2026-10-05", "partial", second)
    assert mode["seen_counts"] == {"pass": 2, "partial": 1}


def test_a_run_keeps_its_time(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    for title, t in (("Morning", "09:15"), ("Afternoon", "14:40:00"), ("Untimed", None)):
        body = {"test_type": "intercept", "title": title, "test_date": "2026-10-08", "result": "pass"}
        if t:
            body["test_time"] = t
        assert editor_client.post(f"/emitters/{emitter_id}/test-records", json=body).status_code == 201
    records = editor_client.get(f"/emitters/{emitter_id}/test-records").json()
    assert [(r["title"], r["test_time"]) for r in records] == [
        ("Afternoon", "14:40:00"),
        ("Morning", "09:15:00"),
        ("Untimed", None),
    ]


def test_the_result_can_be_overridden_with_a_reason(editor_client, viewer_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    mode_id = emitter_with_mode["mode"]["id"]
    base = {"test_type": "intercept", "title": "Field", "test_date": "2026-10-08", "mode_results": [{"mode_id": mode_id, "result": "fail"}]}

    # Overriding needs a reason.
    assert editor_client.post(f"/emitters/{emitter_id}/test-records", json={**base, "result_override": "pass"}).status_code == 422
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={**base, "result_override": "partial", "result_override_note": "Missed only in the clutter sector"},
    )
    assert resp.status_code == 201, resp.text
    record = resp.json()
    assert (record["result"], record["computed_result"], record["result_note"]) == ("partial", "fail", "Missed only in the clutter sector")

    # Changed again afterwards, then set back to what it worked out to.
    url = f"/emitters/{emitter_id}/test-records/{record['id']}/result"
    assert viewer_client.patch(url, json={"result": "pass", "note": "x"}).status_code == 403
    assert editor_client.patch(url, json={"result": "pass"}).status_code == 422
    changed = editor_client.patch(url, json={"result": "pass", "note": "Re-scored by the lead"}).json()
    assert (changed["result"], changed["computed_result"], changed["result_note"]) == ("pass", "fail", "Re-scored by the lead")
    back = editor_client.patch(url, json={"result": "fail"}).json()
    assert (back["result"], back["computed_result"], back["result_note"]) == ("fail", None, None)

    # Overriding with the worked-out result itself is no override.
    same = editor_client.post(
        f"/emitters/{emitter_id}/test-records", json={**base, "result_override": "fail", "result_override_note": "same"}
    ).json()
    assert same["computed_result"] is None and same["result_note"] is None


def test_an_intercept_test_logs_signals_not_tied_to_a_mode(editor_client, emitter_with_mode):
    emitter_id = emitter_with_mode["emitter"]["id"]
    signals = [
        {"observed_values": [{"rf_mean_mhz": 9410, "pri_type": "fixed", "pri_mean_us": 1250, "pw_mean_us": 0.8}],
         "notes": "Short burst at 14:02"},
        {"observed_values": [{"rf_mean_mhz": 9600, "pri_type": "cw"}], "reported_as_unknown": False},
    ]
    resp = editor_client.post(
        f"/emitters/{emitter_id}/test-records",
        json={"test_type": "intercept", "title": "Live pass", "test_date": "2026-10-01", "result": "pass",
              "signals": signals},
    )
    assert resp.status_code == 201, resp.text
    logged = resp.json()["signals"]
    assert [s["reported_as_unknown"] for s in logged] == [True, False]
    assert logged[0]["observed_values"][0]["rf_mean_mhz"] == 9410
    assert logged[0]["notes"] == "Short burst at 14:02"
    # They don't decide the result: nothing else was rated, so it's the one given.
    assert resp.json()["result"] == "pass"
    listed = editor_client.get(f"/emitters/{emitter_id}/test-records").json()
    assert len(next(r for r in listed if r["title"] == "Live pass")["signals"]) == 2


def test_a_signal_needs_measured_values_and_an_intercept_test(editor_client, emitter_with_mode):
    url = f"/emitters/{emitter_with_mode['emitter']['id']}/test-records"
    base = {"title": "X", "test_date": "2026-10-01", "result": "pass"}
    empty = editor_client.post(url, json={**base, "test_type": "intercept", "signals": [{"observed_values": [{}]}]})
    assert empty.status_code == 422
    sim = editor_client.post(
        url,
        json={**base, "test_type": "simulation", "simulation_created_date": "2026-09-01",
              "signals": [{"observed_values": [{"rf_mean_mhz": 9000}]}]},
    )
    assert sim.status_code == 422
