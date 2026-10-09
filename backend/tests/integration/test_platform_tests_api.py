"""Platform tests: every pinned Emitter tested in one run."""

from tests.integration.test_modes_api import FIXED_LINE


def _emitter(client, name, lines=0):
    e = client.post("/emitters", json={"name": name, "designation": name[:3].upper()}).json()
    g = client.post(f"/emitters/{e['id']}/ew-groups", json={"name": "G"}).json()
    s = client.post(f"/emitters/{e['id']}/sources", json={"name": "S", "source_date": "2025-01-01"}).json()
    mode = client.post(
        f"/ew-groups/{g['id']}/modes",
        json={"source_id": s["id"], "name": "M1", "pri_type": "fixed", "line": FIXED_LINE},
    ).json()
    test_lines = []
    if lines:
        test_lines = client.post(
            f"/emitters/{e['id']}/test-lines/import",
            json={"lines": [{"label": f"L{i}"} for i in range(lines)], "created_date": "2026-01-01"},
        ).json()
    version = client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"}).json()
    return {"emitter": e, "mode": mode, "lines": test_lines, "version": version}


def _platform(client, *emitters):
    p = client.post("/platforms", json={"name": "Tested Platform " + "".join(x["emitter"]["name"] for x in emitters)}).json()
    for x in emitters:
        client.post(
            f"/platforms/{p['id']}/links",
            json={"emitter_id": x["emitter"]["id"], "emitter_version_id": x["version"]["id"]},
        )
    return p


def test_logging_a_platform_test_writes_a_record_per_emitter_against_the_pinned_version(editor_client):
    a = _emitter(editor_client, "Alpha", lines=2)
    b = _emitter(editor_client, "Bravo", lines=1)
    platform = _platform(editor_client, a, b)
    # A newer Emitter version after pinning: the test is still of the pinned one.
    editor_client.post(f"/emitters/{a['emitter']['id']}/versions", json={"change_summary": "later"})
    draft = editor_client.post(
        f"/platforms/{platform['id']}/test-drafts",
        json={"title": "Sea trial", "test_type": "simulation", "state": {"x": 1}},
    ).json()
    assert draft["platform_id"] == platform["id"] and draft["emitter_id"] is None
    assert [d["id"] for d in editor_client.get(f"/platforms/{platform['id']}/test-drafts").json()] == [draft["id"]]

    resp = editor_client.post(
        f"/platforms/{platform['id']}/tests",
        json={
            "title": "Sea trial",
            "test_type": "simulation",
            "test_date": "2026-10-01",
            "simulation_created_date": "2026-09-30",
            "notes": "Whole run",
            "draft_id": draft["id"],
            "emitters": [
                {
                    "emitter_id": a["emitter"]["id"],
                    "line_results": [
                        {"test_line_id": a["lines"][0]["id"], "outcome": "pass"},
                        {"test_line_id": a["lines"][1]["id"], "outcome": "partial"},
                    ],
                },
                {
                    "emitter_id": b["emitter"]["id"],
                    "line_results": [{"test_line_id": b["lines"][0]["id"], "outcome": "pass"}],
                    "notes": "Only B",
                },
            ],
        },
    )
    assert resp.status_code == 201, resp.text
    test = resp.json()
    assert test["result"] == "partial"  # the worst of the Emitters'
    assert {(e["emitter_name"], e["result"], e["version_number"], e["lines"]) for e in test["emitters"]} == {
        ("Alpha", "partial", 1, 2),
        ("Bravo", "pass", 1, 1),
    }
    # Each Emitter's record is in its own test history, pinned to the version tested.
    [record] = editor_client.get(f"/emitters/{a['emitter']['id']}/test-records").json()
    assert record["platform_test_id"] == test["id"]
    assert record["emitter_version_id"] == a["version"]["id"]
    assert record["notes"] == "Whole run"
    [record_b] = editor_client.get(f"/emitters/{b['emitter']['id']}/test-records").json()
    assert record_b["notes"] == "Only B"
    # The draft is used up; the test is listed on the Platform.
    assert editor_client.get(f"/platforms/{platform['id']}/test-drafts").json() == []
    [listed] = editor_client.get(f"/platforms/{platform['id']}/tests").json()
    assert listed["id"] == test["id"] and listed["platform_version_number"] is not None


def test_a_platform_test_is_all_or_nothing(editor_client):
    a = _emitter(editor_client, "Charlie", lines=1)
    b = _emitter(editor_client, "Delta")
    platform = _platform(editor_client, a, b)
    body = {
        "title": "Bad run",
        "test_type": "simulation",
        "test_date": "2026-10-01",
        "simulation_created_date": "2026-09-30",
        "emitters": [
            {"emitter_id": a["emitter"]["id"], "line_results": [{"test_line_id": a["lines"][0]["id"], "outcome": "pass"}]},
            # Nothing to derive Delta's result from, and no result given.
            {"emitter_id": b["emitter"]["id"]},
        ],
    }
    resp = editor_client.post(f"/platforms/{platform['id']}/tests", json=body)
    assert resp.status_code == 422
    assert "Delta" in resp.json()["detail"]
    assert editor_client.get(f"/emitters/{a['emitter']['id']}/test-records").json() == []
    assert editor_client.get(f"/platforms/{platform['id']}/tests").json() == []

    # An Emitter that isn't pinned can't be in it.
    stranger = _emitter(editor_client, "Echo")
    body["emitters"] = [{"emitter_id": stranger["emitter"]["id"], "result": "pass"}]
    assert editor_client.post(f"/platforms/{platform['id']}/tests", json=body).status_code == 422

    # A result given by hand is enough for an Emitter with nothing to rate.
    body["emitters"] = [{"emitter_id": b["emitter"]["id"], "result": "inconclusive"}]
    resp = editor_client.post(f"/platforms/{platform['id']}/tests", json=body)
    assert resp.status_code == 201, resp.text
    assert resp.json()["result"] == "inconclusive"


def test_emitter_drafts_and_platform_drafts_stay_apart(editor_client):
    a = _emitter(editor_client, "Foxtrot")
    platform = _platform(editor_client, a)
    editor_client.post(
        f"/platforms/{platform['id']}/test-drafts", json={"title": "P", "test_type": "intercept", "state": {}}
    )
    editor_client.post(
        f"/emitters/{a['emitter']['id']}/test-drafts", json={"title": "E", "test_type": "intercept", "state": {}}
    )
    assert [d["title"] for d in editor_client.get(f"/emitters/{a['emitter']['id']}/test-drafts").json()] == ["E"]
    assert [d["title"] for d in editor_client.get(f"/platforms/{platform['id']}/test-drafts").json()] == ["P"]
