"""The weekly progress update: the 7 days up to a date — the current MDF's
progress, the Emitter work, the testing and what's next — for a section's
morning brief. Read-only; anyone signed in can make it."""

from datetime import date, timedelta

from tests.integration.test_platform_uniqueness_api import LINE, _setup


def _uniqueness(client, mdf):
    body = client.get(f"/pcl/mdfs/{mdf['id']}/uniqueness").json()
    return {e["emitter_name"]: e["emitter_id"] for p in body["platforms"] for e in p["emitters"]}


def test_the_week_in_numbers(editor_client, viewer_client):
    mdf = _setup(editor_client)
    ids = _uniqueness(editor_client, mdf)
    fire = ids["Fire Control"]
    editor_client.post(f"/emitters/{fire}/status", json={"new_status": "in_review"})
    assert editor_client.post(f"/emitters/{fire}/status", json={"new_status": "validated", "note": "SIM clean"}).status_code == 200
    # A Mode added to Nav Radar, and a version saved.
    group = editor_client.get(f"/emitters/{ids['Nav Radar']}/ew-groups").json()[0]["id"]
    source = editor_client.get(f"/emitters/{ids['Nav Radar']}/sources").json()[0]["id"]
    assert editor_client.post(f"/ew-groups/{group}/modes", json={"source_id": source, "name": "Nav 2", "pri_type": "fixed", "line": LINE}).status_code == 201
    editor_client.post(f"/emitters/{ids['Nav Radar']}/versions", json={"change_summary": "Nav 2"})
    editor_client.post(
        f"/emitters/{fire}/test-records",
        json={"test_type": "simulation", "title": "Week run", "test_date": date.today().isoformat(),
              "simulation_created_date": date.today().isoformat(), "received_power_dbfs": -40, "result": "pass"},
    )  # fmt: skip
    editor_client.post(f"/mdfs/{mdf['id']}/log", json={"kind": "progress", "body": "Fleet MDF on track."})

    resp = viewer_client.get("/reports/weekly")
    assert resp.status_code == 200, resp.text
    week = resp.json()
    assert week["end"] == date.today().isoformat()
    assert week["start"] == (date.today() - timedelta(days=6)).isoformat()

    m = week["mdf"]
    assert m["name"] == "Fleet" and m["emitters"] == 4
    assert (m["operational"], m["operational_week_ago"]) == (1, 0)
    assert {s["label"]: s["count"] for s in m["by_status"]} == {"In progress": 3, "Operational": 1}
    assert [x["body"] for x in m["log"]] == ["Fleet MDF on track."]
    assert m["not_done"] >= 3 and len(m["next_up"]) <= 6

    e = week["emitters"]
    assert e["to_operational"] == 1
    assert [(x["emitter"], x["to"]) for x in e["status_moves"]] == [("Fire Control", "Testing"), ("Fire Control", "Operational")]
    # The six Modes made in setup, plus Nav 2.
    assert e["modes"]["added"] == 7
    assert ("Nav Radar", 2) in [(v["emitter"], v["version"]) for v in e["versions"]]

    t = week["testing"]
    assert t["emitter_runs"] == 1 and t["emitter_results"]["pass"] == 1


def test_an_earlier_week_has_none_of_it(editor_client):
    mdf = _setup(editor_client)
    fire = _uniqueness(editor_client, mdf)["Fire Control"]
    editor_client.post(f"/emitters/{fire}/status", json={"new_status": "in_review"})
    week = editor_client.get("/reports/weekly", params={"end": (date.today() - timedelta(days=30)).isoformat()}).json()
    assert week["emitters"]["status_moves"] == [] and week["emitters"]["modes"]["added"] == 0
    assert week["testing"]["emitter_runs"] == 0
    assert week["mdf"]["log"] == []
