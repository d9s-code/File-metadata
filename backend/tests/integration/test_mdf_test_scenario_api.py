"""An MDF test can record what was observed: the Platforms presented, the
Emitters on the air with each (detected, how soon, what each was reported
as — an Emitter of another Platform is a cross-Platform mix-up), and which
Platform each was intercepted as. Its result is worked out from that unless
given, and today's confidence rules say which Platform what was heard points to.

The fleet (see test_platform_uniqueness_api): the Frigate has Fire Control,
Shared A and Shared B; the Corvette has Nav Radar and Shared A; the Tug has Shared B."""

from tests.integration.test_platform_uniqueness_api import _setup


def _options(client, mdf):
    body = client.get(f"/mdfs/{mdf['id']}/test-records/scenario-options").json()
    platforms = {p["platform_name"]: p for p in body["platforms"]}
    emitters = {(p["platform_name"], e["emitter_name"]): e for p in body["platforms"] for e in p["emitters"]}
    return platforms, emitters


def _log(client, mdf, platforms, **extra):
    return client.post(
        f"/mdfs/{mdf['id']}/test-records",
        json={
            "test_type": "simulation",
            "title": "Fleet scenario",
            "test_date": "2026-11-12",
            "simulation_created_date": "2026-11-01",
            "received_power_dbfs": -40,
            "mdf_scenario": {"platforms": platforms},
            **extra,
        },
    )


def test_the_options_are_the_saved_versions_platforms_emitters_and_modes(editor_client):
    mdf = _setup(editor_client)
    platforms, emitters = _options(editor_client, mdf)
    assert list(platforms) == ["Corvette", "Frigate", "Tug"]
    assert sorted(emitters[("Frigate", "Fire Control")]["modes"]) == ["Burst", "Search", "Track"]


def test_a_cross_platform_mixup_and_the_platform_it_was_intercepted_as(editor_client):
    mdf = _setup(editor_client)
    platforms, emitters = _options(editor_client, mdf)
    frigate, corvette = platforms["Frigate"], platforms["Corvette"]
    fire, shared_a = emitters[("Frigate", "Fire Control")], emitters[("Frigate", "Shared A")]
    nav = emitters[("Corvette", "Nav Radar")]
    resp = _log(
        editor_client,
        mdf,
        [
            {
                "platform_id": frigate["platform_id"],
                "intercepted_as_platform_id": corvette["platform_id"],
                "emitters": [
                    {"emitter_id": fire["emitter_id"], "detected": True, "time_to_detect_s": 2, "reported_self": True},
                    # Fire Control's Search taken for the Corvette's Nav Radar.
                    {
                        "emitter_id": shared_a["emitter_id"],
                        "detected": True,
                        "reports": [{"reported_emitter_id": nav["emitter_id"], "reported_mode": "nav"}],
                    },
                ],
            },
        ],
    )
    assert resp.status_code == 201, resp.text
    record = resp.json()
    assert record["result"] == "fail"
    [presented] = record["mdf_test_platforms"]
    assert (presented["platform_name"], presented["intercepted_as_name"]) == ("Frigate", "Corvette")
    rows = {r["emitter_name"]: r for r in record["scenario_emitters"]}
    assert rows["Fire Control"]["result"] == "pass" and rows["Fire Control"]["platform_name"] == "Frigate"
    [mixup] = rows["Shared A"]["reports"]
    assert (mixup["reported_emitter_name"], mixup["reported_platform_name"], mixup["reported_mode"]) == ("Nav Radar", "Corvette", "Nav")
    v = record["scenario_verdicts"]
    assert (v["detection"], v["identification"], v["mixups"], v["mixup_count"]) == ("pass", "partial", "fail", 1)
    # Still an MDF test like any other: it's in the MDF's test history.
    listed = editor_client.get(f"/mdfs/{mdf['id']}/test-records").json()
    assert [r["id"] for r in listed] == [record["id"]] and listed[0]["scenario_verdicts"]["mixup_count"] == 1


def test_an_emitter_on_two_platforms_can_be_taken_for_its_copy_on_the_other(editor_client):
    mdf = _setup(editor_client)
    platforms, emitters = _options(editor_client, mdf)
    shared_a = emitters[("Frigate", "Shared A")]
    resp = _log(
        editor_client,
        mdf,
        [{"platform_id": platforms["Frigate"]["platform_id"], "emitters": [
            {"emitter_id": shared_a["emitter_id"], "detected": True, "reports": [{"reported_emitter_id": shared_a["emitter_id"]}]},
        ]}],
    )  # fmt: skip
    assert resp.status_code == 201, resp.text
    [row] = resp.json()["scenario_emitters"]
    assert row["reports"][0]["reported_platform_name"] == "Corvette"


def test_what_doesnt_fit_the_mdf_is_refused_and_nothing_is_written(editor_client):
    mdf = _setup(editor_client)
    platforms, emitters = _options(editor_client, mdf)
    frigate, tug = platforms["Frigate"]["platform_id"], platforms["Tug"]["platform_id"]
    nav = emitters[("Corvette", "Nav Radar")]["emitter_id"]
    fire = emitters[("Frigate", "Fire Control")]["emitter_id"]
    other = editor_client.post("/platforms", json={"name": "Not in the MDF"}).json()
    bad = [
        [{"platform_id": other["id"]}],
        [{"platform_id": frigate, "intercepted_as_platform_id": other["id"]}],
        # Nav Radar isn't on the Tug.
        [{"platform_id": tug, "emitters": [{"emitter_id": nav, "detected": True}]}],
        [{"platform_id": frigate}, {"platform_id": frigate}],
        [{"platform_id": frigate, "emitters": [{"emitter_id": fire, "detected": True, "reports": [{"reported_emitter_id": nav, "reported_mode": "Nope"}]}]}],
    ]
    for platforms_in in bad:
        assert _log(editor_client, mdf, platforms_in).status_code == 422, platforms_in
    assert editor_client.get(f"/mdfs/{mdf['id']}/test-records").json() == []


def test_confidence_from_what_was_heard(editor_client):
    mdf = _setup(editor_client)
    platforms, emitters = _options(editor_client, mdf)
    frigate_id = platforms["Frigate"]["platform_id"]
    editor_client.post(f"/pcl/platforms/{frigate_id}/rules", json={"level": 3, "text": '"Fire Control"'})
    editor_client.post(f"/pcl/platforms/{platforms['Corvette']['platform_id']}/rules", json={"level": 1, "text": '"Shared A"'})
    fire = emitters[("Frigate", "Fire Control")]["emitter_id"]
    shared_a = emitters[("Frigate", "Shared A")]["emitter_id"]
    record = _log(
        editor_client,
        mdf,
        [{"platform_id": frigate_id, "intercepted_as_platform_id": frigate_id, "emitters": [
            {"emitter_id": fire, "detected": True, "reported_self": True},
            {"emitter_id": shared_a, "detected": True, "reported_self": True},
        ]}],
    ).json()  # fmt: skip
    body = editor_client.get(f"/pcl/mdf-tests/{record['id']}").json()
    [presented] = body["platforms"]
    assert presented["heard"] == ["Fire Control", "Shared A"]
    assert [(lv["platform_name"], lv["level"]) for lv in presented["levels"]] == [("Frigate", 3), ("Corvette", 1)]
    assert presented["intercepted_as_name"] == "Frigate"


def test_an_mdf_test_without_a_scenario_is_as_before(editor_client):
    mdf = _setup(editor_client)
    resp = editor_client.post(
        f"/mdfs/{mdf['id']}/test-records",
        json={"test_type": "simulation", "title": "Plain", "test_date": "2026-11-12", "simulation_created_date": "2026-11-01", "received_power_dbfs": -40, "result": "pass"},
    )  # fmt: skip
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["result"] == "pass" and body["mdf_test_platforms"] == [] and body["scenario_verdicts"] is None
