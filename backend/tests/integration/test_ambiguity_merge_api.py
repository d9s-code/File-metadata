"""Merging a finding's two Modes from the ambiguity page."""

import pytest

from tests.integration.test_ambiguity_api import FIXED_LINE


@pytest.fixture()
def emitter_with_near_duplicates(editor_client):
    """Two near-identical Search Modes (one with a test record and an
    intercept link), and a Track Mode just above them in RF."""
    emitter = editor_client.post("/emitters", json={"name": "Merge Emitter"}).json()
    group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Group"}).json()
    src1 = editor_client.post(f"/emitters/{emitter['id']}/sources", json={"name": "Datasheet", "source_date": "2025-01-01"}).json()
    src2 = editor_client.post(f"/emitters/{emitter['id']}/sources", json={"name": "Field notes", "source_date": "2025-02-01"}).json()

    def mode(name, source, **line):
        return editor_client.post(
            f"/ew-groups/{group['id']}/modes",
            json={"source_id": source["id"], "name": name, "pri_type": "fixed", "line": {**FIXED_LINE, **line}, "notes": f"{name} notes"},
        ).json()

    a = mode("Search A", src1)  # RF 2900–3100
    b = mode("Search B", src2, rf_min_mhz=2950, rf_max_mhz=3150, pw_delta=0.1)
    track = mode("Track", src1, rf_min_mhz=3140, rf_max_mhz=3300)  # touches B only
    record = editor_client.post(
        f"/emitters/{emitter['id']}/test-records",
        json={"test_type": "intercept", "title": "Run 1", "test_date": "2026-01-01",
              "mode_results": [{"mode_id": b["id"], "result": "pass"}]},
    ).json()
    editor_client.post(f"/emitters/{emitter['id']}/versions", json={"change_summary": "v1"})
    run = editor_client.post("/ambiguity/runs", json={"scope_type": "emitter", "scope_id": emitter["id"]}).json()
    findings = editor_client.get(f"/ambiguity/runs/{run['id']}/findings").json()
    pair = next(f for f in findings if {f["mode_id_a"], f["mode_id_b"]} == {a["id"], b["id"]})
    keep = "a" if pair["mode_id_a"] == a["id"] else "b"  # always keep Search A
    return {"emitter": emitter, "group": group, "a": a, "b": b, "track": track, "record": record,
            "finding": pair, "keep": keep}


def test_preview_says_what_would_change_and_changes_nothing(editor_client, emitter_with_near_duplicates):
    ctx = emitter_with_near_duplicates
    resp = editor_client.post(f"/ambiguity/findings/{ctx['finding']['id']}/merge-preview", json={"keep": ctx["keep"]})
    assert resp.status_code == 200, resp.text
    plan = resp.json()
    assert plan["kept"]["name"] == "Search A" and plan["removed"]["name"] == "Search B"
    # The kept Mode's RF becomes the union, compared with the wider margin (±1).
    assert plan["kept"]["before"]["rf"] == [2899, 3101]
    assert plan["kept"]["after"]["rf"] == [2899, 3151]
    assert plan["kept"]["after"]["pw"] == [0.4, 1.3]  # the wider PW margin, 0.1
    assert plan["links_moved"]["test_records"] == 1
    # Widening A to 3150 makes it overlap Track, which it didn't before.
    assert [(w["mode_name"], w["before"]) for w in plan["new_overlaps"]] == [("Track", "none")]

    modes = editor_client.get(f"/ew-groups/{ctx['group']['id']}/modes").json()
    assert {m["name"] for m in modes} == {"Search A", "Search B", "Track"}


def test_merge_widens_the_kept_mode_moves_history_and_deletes_the_other(editor_client, emitter_with_near_duplicates):
    ctx = emitter_with_near_duplicates
    resp = editor_client.post(f"/ambiguity/findings/{ctx['finding']['id']}/merge", json={"keep": ctx["keep"]})
    assert resp.status_code == 200, resp.text
    resolution = resp.json()["resolution"]
    assert resolution["action"] == "merged"
    assert resolution["kept_name"] == "Search A" and resolution["removed_name"] == "Search B"
    assert resolution["by"] == "editor_t"

    modes = {m["name"]: m for m in editor_client.get(f"/ew-groups/{ctx['group']['id']}/modes").json()}
    assert set(modes) == {"Search A", "Track"}
    kept = modes["Search A"]
    assert (kept["line"]["rf_min_mhz"], kept["line"]["rf_max_mhz"]) == (2900, 3150)
    assert kept["line"]["pw_delta"] == 0.1
    assert 'Merged with "Search B" (sources "Field notes"' in kept["notes"]
    # Search A now comes from both Sources.
    assert kept["source_names"] == ["Datasheet", "Field notes"]
    assert "Its notes: Search B notes" in kept["notes"]

    # The test record that exercised Search B now lists Search A.
    records = editor_client.get(f"/emitters/{ctx['emitter']['id']}/test-records").json()
    record = next(r for r in records if r["id"] == ctx["record"]["id"])
    assert [m["mode_id"] for m in record["modes"]] == [ctx["a"]["id"]]

    audit = editor_client.get("/audit-log", params={"emitter_id": ctx["emitter"]["id"]}).json()
    summaries = [e["summary"] for e in (audit["items"] if isinstance(audit, dict) else audit)]
    assert "Merged Mode 'Search B' into 'Search A'" in summaries

    # Done once: asking again is refused.
    again = editor_client.post(f"/ambiguity/findings/{ctx['finding']['id']}/merge", json={"keep": ctx["keep"]})
    assert again.status_code == 409


def test_merge_needs_the_emitter_checked_out(editor_client, viewer_client, emitter_with_near_duplicates):
    ctx = emitter_with_near_duplicates
    assert viewer_client.post(f"/ambiguity/findings/{ctx['finding']['id']}/merge", json={"keep": "a"}).status_code == 403
    editor_client.delete(f"/emitters/{ctx['emitter']['id']}/checkout")
    resp = editor_client.post(f"/ambiguity/findings/{ctx['finding']['id']}/merge", json={"keep": ctx["keep"]})
    assert resp.status_code == 409
    assert "Start editing" in resp.json()["detail"]


def test_modes_that_cant_be_merged_say_why(editor_client, emitter_with_near_duplicates):
    ctx = emitter_with_near_duplicates
    # Make B a CW Mode in the draft: different PRI types can't merge.
    editor_client.patch(
        f"/ew-groups/{ctx['group']['id']}/modes/{ctx['b']['id']}",
        json={"pri_type": "cw", "line": {**FIXED_LINE, "pri_min_us": None, "pri_max_us": None,
                                          "jitter_min_us": None, "jitter_max_us": None, "pri_delta": None}},
    )
    resp = editor_client.post(f"/ambiguity/findings/{ctx['finding']['id']}/merge-preview", json={"keep": ctx["keep"]})
    assert resp.status_code == 422
    assert "different PRI types" in resp.json()["detail"]
