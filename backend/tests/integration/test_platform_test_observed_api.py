"""A Platform test records what was observed with the Emitters on the air
together: detected or missed (how soon, by which dwell), and what each was
reported as — itself, Default Unknown, or another of the Platform's Emitters
(a mix-up, optionally Mode for Mode). Each Emitter's result is worked out
from that unless set, and the run gets three verdicts."""

from tests.integration.test_platform_tests_api import _emitter, _platform


def _strategy(client, platform_id):
    own = client.post("/dwell-strategies", json={"name": "Patrol", "platform_id": platform_id}).json()
    client.patch(
        f"/dwell-strategies/{own['id']}",
        json={
            "dwells": [{"freq_mhz": 2900, "dwell_time_ms": 100}, {"freq_mhz": 3000, "dwell_time_ms": 150}],
            "save_version": True,
            "change_summary": "dwells",
        },
    )
    versions = client.get(f"/dwell-strategies/{own['id']}/versions").json()
    latest = max(versions, key=lambda v: v["version_number"])
    assert latest["version_number"] == 2, versions
    return latest["id"]


def _body(version_id, *emitters):
    return {
        "title": "On the air together",
        "test_type": "simulation",
        "received_power_dbfs": -40,
        "test_date": "2026-11-01",
        "simulation_created_date": "2026-10-01",
        "dwell_strategy_version_id": version_id,
        "emitters": list(emitters),
    }


def test_what_was_observed_gives_results_and_verdicts(editor_client):
    a, b, c = _emitter(editor_client, "Alpha"), _emitter(editor_client, "Bravo"), _emitter(editor_client, "Charlie")
    platform = _platform(editor_client, a, b, c)
    version = _strategy(editor_client, platform["id"])
    ids = {x["emitter"]["name"]: x["emitter"]["id"] for x in (a, b, c)}
    resp = editor_client.post(
        f"/platforms/{platform['id']}/tests",
        json=_body(
            version,
            # Alpha: caught by dwell 2 after 1.5 s, reported as itself.
            {"emitter_id": ids["Alpha"], "detected": True, "time_to_detect_s": 1.5, "dwell_index": 2, "reported_self": True},
            # Bravo: reported as Charlie, its M1 taken for Charlie's M1.
            {
                "emitter_id": ids["Bravo"],
                "detected": True,
                "reports": [{"reported_emitter_id": ids["Charlie"], "expected_mode": "m1", "reported_mode": "M1"}],
            },
            # Charlie: missed.
            {"emitter_id": ids["Charlie"], "detected": False},
        ),
    )
    assert resp.status_code == 201, resp.text
    test = resp.json()
    by = {e["emitter_name"]: e for e in test["emitters"]}
    assert {n: e["result"] for n, e in by.items()} == {"Alpha": "pass", "Bravo": "fail", "Charlie": "fail"}
    alpha = by["Alpha"]["observed"]
    assert (alpha["detected"], alpha["time_to_detect_s"], alpha["dwell_index"], alpha["dwell_label"]) == (True, 1.5, 2, "Dwell 2 · 3000 MHz")
    [mixup] = by["Bravo"]["observed"]["reports"]
    assert (mixup["reported_emitter_name"], mixup["expected_mode"], mixup["reported_mode"]) == ("Charlie", "M1", "M1")
    v = test["verdicts"]
    assert (v["detection"], v["detected"], v["observed"]) == ("partial", 2, 3)
    assert (v["identification"], v["identified"]) == ("partial", 1)
    assert (v["mixups"], v["mixup_count"]) == ("fail", 1)
    assert test["result"] == "fail"
    # Each Emitter's own record has its result, so its Test History shows it.
    record = editor_client.get(f"/emitters/{ids['Alpha']}/test-records").json()[0]
    assert record["result"] == "pass" and record["platform_test_id"] == test["id"]
    audit = editor_client.get("/audit-log").json()["items"]
    assert any(e["summary"].endswith("— 2 of 3 detected, 1 mix-up") for e in audit)


def test_reported_as_itself_and_another_is_partial_and_nothing_reported_is_inconclusive(editor_client):
    a, b = _emitter(editor_client, "Delta"), _emitter(editor_client, "Echo")
    platform = _platform(editor_client, a, b)
    ida, idb = a["emitter"]["id"], b["emitter"]["id"]
    resp = editor_client.post(
        f"/platforms/{platform['id']}/tests",
        json=_body(
            None,
            {"emitter_id": ida, "detected": True, "reported_self": True, "reports": [{"reported_emitter_id": idb}]},
            {"emitter_id": idb, "detected": True},
        ),
    )
    assert resp.status_code == 201, resp.text
    by = {e["emitter_name"]: e["result"] for e in resp.json()["emitters"]}
    assert by == {"Delta": "partial", "Echo": "inconclusive"}


def test_a_result_set_by_hand_wins(editor_client):
    a = _emitter(editor_client, "Foxtrot")
    platform = _platform(editor_client, a)
    resp = editor_client.post(
        f"/platforms/{platform['id']}/tests",
        json=_body(None, {"emitter_id": a["emitter"]["id"], "detected": False, "result": "inconclusive"}),
    )
    assert resp.status_code == 201, resp.text
    [row] = resp.json()["emitters"]
    assert row["result"] == "inconclusive" and row["observed"]["detected"] is False


def test_what_doesnt_fit_the_run_is_refused(editor_client):
    a, b = _emitter(editor_client, "Golf"), _emitter(editor_client, "Hotel")
    platform = _platform(editor_client, a, b)
    stranger = _emitter(editor_client, "India")
    version = _strategy(editor_client, platform["id"])
    ida, idb = a["emitter"]["id"], b["emitter"]["id"]
    url = f"/platforms/{platform['id']}/tests"
    bad = [
        # Not one of the Platform's Emitters.
        {"emitter_id": ida, "detected": True, "reports": [{"reported_emitter_id": stranger["emitter"]["id"]}]},
        # A Mode the reported Emitter doesn't have.
        {"emitter_id": ida, "detected": True, "reports": [{"reported_emitter_id": idb, "reported_mode": "Nope"}]},
        # Reported as itself isn't a mix-up.
        {"emitter_id": ida, "detected": True, "reports": [{"reported_emitter_id": ida}]},
        # The Strategy version has two dwells.
        {"emitter_id": ida, "detected": True, "dwell_index": 3, "reported_self": True},
        # Missed, yet reported.
        {"emitter_id": ida, "detected": False, "reported_self": True},
        # A time to detect for a missed Emitter.
        {"emitter_id": ida, "detected": False, "time_to_detect_s": 2},
    ]
    for entry in bad:
        assert editor_client.post(url, json=_body(version, entry)).status_code == 422, entry
    # Nothing was logged.
    assert editor_client.get(f"/platforms/{platform['id']}/tests").json() == []


def test_a_run_without_observations_reads_as_before(editor_client):
    a = _emitter(editor_client, "Juliet")
    platform = _platform(editor_client, a)
    resp = editor_client.post(f"/platforms/{platform['id']}/tests", json=_body(None, {"emitter_id": a["emitter"]["id"], "result": "pass"}))
    assert resp.status_code == 201, resp.text
    test = resp.json()
    assert test["verdicts"] is None and test["emitters"][0]["observed"] is None and test["result"] == "pass"


def test_only_the_emitters_transmitting_are_in_the_run(editor_client):
    # Three pinned; only X and Y were transmitting, under the Strategy's dwell 1.
    x, y, z = _emitter(editor_client, "Xray"), _emitter(editor_client, "Yankee"), _emitter(editor_client, "Zulu")
    platform = _platform(editor_client, x, y, z)
    version = _strategy(editor_client, platform["id"])
    resp = editor_client.post(
        f"/platforms/{platform['id']}/tests",
        json=_body(
            version,
            {"emitter_id": x["emitter"]["id"], "detected": True, "dwell_index": 1, "reported_self": True},
            {"emitter_id": y["emitter"]["id"], "detected": True, "dwell_index": 1, "reported_self": True},
        ),
    )
    assert resp.status_code == 201, resp.text
    test = resp.json()
    assert sorted(e["emitter_name"] for e in test["emitters"]) == ["Xray", "Yankee"]
    v = test["verdicts"]
    assert (v["observed"], v["detected"], v["identified"], v["mixup_count"]) == (2, 2, 2, 0)
    assert test["result"] == "pass"
    # Zulu wasn't on the air: no record in its Test History.
    assert editor_client.get(f"/emitters/{z['emitter']['id']}/test-records").json() == []

    # One Emitter alone is a Platform test too.
    alone = editor_client.post(
        f"/platforms/{platform['id']}/tests",
        json=_body(version, {"emitter_id": z["emitter"]["id"], "detected": False}),
    )
    assert alone.status_code == 201, alone.text
    assert alone.json()["verdicts"]["detection"] == "fail"
