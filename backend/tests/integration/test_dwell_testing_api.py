"""Tracking a Dwell Strategy's testing: for each Platform it covers, whether
each pinned Emitter has a simulation run with the Strategy that still holds."""

from tests.integration.test_ambiguity_api import FIXED_LINE


def _emitter(client, name, rf_min, rf_max):
    emitter = client.post("/emitters", json={"name": name}).json()
    eid = emitter["id"]
    group = client.post(f"/emitters/{eid}/ew-groups", json={"name": "G"}).json()
    source = client.post(f"/emitters/{eid}/sources", json={"name": "S", "source_date": "2026-01-01"}).json()
    mode = client.post(
        f"/ew-groups/{group['id']}/modes",
        json={"source_id": source["id"], "name": "M", "pri_type": "fixed",
              "line": {**FIXED_LINE, "rf_min_mhz": rf_min, "rf_max_mhz": rf_max}},
    ).json()  # fmt: skip
    client.post(f"/emitters/{eid}/versions", json={"change_summary": "v1"})
    return {"id": eid, "group": group, "mode": mode}


def _latest_version_id(client, eid):
    return client.get(f"/emitters/{eid}/versions").json()[-1]["id"]


def _run(client, eid, strategy_version_id=None, title="Sim"):
    resp = client.post(
        f"/emitters/{eid}/test-records",
        json={"test_type": "simulation", "title": title, "test_date": "2026-10-01", "simulation_created_date": "2026-09-01",
              "received_power_dbfs": -40, "result": "pass", "emitter_version_id": _latest_version_id(client, eid),
              "dwell_strategy_version_id": strategy_version_id},
    )  # fmt: skip
    assert resp.status_code == 201, resp.text
    return resp.json()


def _save(client, sid, dwells):
    client.patch(f"/dwell-strategies/{sid}", json={"dwells": dwells})
    return client.post(f"/dwell-strategies/{sid}/versions", json={"change_summary": "dwells"}).json()


def _states(client, sid) -> dict[str, tuple[str, str | None]]:
    testing = client.get(f"/dwell-strategies/{sid}/testing").json()
    [platform] = testing["platforms"]
    return {e["emitter_name"]: (e["state"], e["reason"]) for e in platform["emitters"]}


def test_each_pinned_emitter_is_tested_stale_untested_or_not_covered(editor_client):
    s_band = _emitter(editor_client, "S-band", 2900, 3100)
    x_band = _emitter(editor_client, "X-band", 9400, 9500)
    c_band = _emitter(editor_client, "C-band", 5000, 5100)
    platform = editor_client.post("/platforms", json={"name": "Frigate"}).json()
    for e in (s_band, x_band, c_band):
        assert editor_client.post(f"/platforms/{platform['id']}/links", json={"emitter_id": e["id"]}).status_code in (200, 201)
    sid = editor_client.post("/dwell-strategies", json={"name": "Patrol", "platform_id": platform["id"]}).json()["id"]
    dwells = [
        {"freq_mhz": 3000, "dwell_time_ms": 100, "collect_time_ms": 50},
        {"freq_mhz": 9450, "dwell_time_ms": 100, "collect_time_ms": 50},
    ]
    v2 = _save(editor_client, sid, dwells)

    _run(editor_client, s_band["id"], v2["id"])
    # Only simulation runs count; nothing else is linked yet.
    assert _states(editor_client, sid) == {
        "S-band": ("tested", None),
        "X-band": ("untested", None),
        "C-band": ("not_covered", "no dwell reaches its RF"),
    }

    # Changing the X-band dwell doesn't touch the S-band test…
    v3 = _save(editor_client, sid, [dwells[0], {**dwells[1], "dwell_time_ms": 120}])
    assert _states(editor_client, sid)["S-band"] == ("tested", None)
    # …changing the collect time of the dwell covering it does.
    _save(editor_client, sid, [{**dwells[0], "collect_time_ms": 60}, {**dwells[1], "dwell_time_ms": 120}])
    assert _states(editor_client, sid)["S-band"] == ("stale", "the dwells covering it changed since")

    # A run logged without the Strategy, linked afterwards.
    run = _run(editor_client, x_band["id"], None, title="Old X run")
    latest = editor_client.get(f"/dwell-strategies/{sid}").json()
    latest_version_id = [v for v in editor_client.get(f"/dwell-strategies/{sid}/versions").json()
                         if v["version_number"] == latest["latest_version_number"]][0]["id"]  # fmt: skip
    linked = editor_client.patch(
        f"/emitters/{x_band['id']}/test-records/{run['id']}/dwell-strategy", json={"dwell_strategy_version_id": latest_version_id}
    )
    assert linked.status_code == 200, linked.text
    assert linked.json()["dwell"] == "Patrol v4"
    assert _states(editor_client, sid)["X-band"] == ("tested", None)
    assert v3["version_number"] == 3

    # The Emitter's RF moving outside what was tested makes it stale again.
    editor_client.post(f"/emitters/{x_band['id']}/checkout")
    wider = {**FIXED_LINE, "rf_min_mhz": 9300, "rf_max_mhz": 9500}
    editor_client.patch(f"/ew-groups/{x_band['group']['id']}/modes/{x_band['mode']['id']}", json={"pri_type": "fixed", "line": wider})
    editor_client.post(f"/emitters/{x_band['id']}/versions", json={"change_summary": "wider"})
    editor_client.post(f"/platforms/{platform['id']}/links/repin-latest")
    assert _states(editor_client, sid)["X-band"] == ("stale", "its RF moved outside what was tested")

    # The list and the dashboard flag it.
    [summary] = [s for s in editor_client.get("/dwell-strategies").json() if s["id"] == sid]
    assert summary["testing"] == {"tested": 0, "stale": 2, "untested": 0, "not_covered": 1}
    attention = editor_client.get("/dashboard/attention").json()["needs_attention"]
    assert any(i["category"] == "dwell" and i["message"] == "Strategy 'Patrol': 2 stale, 1 not covered" for i in attention)
