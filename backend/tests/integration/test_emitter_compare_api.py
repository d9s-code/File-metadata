"""Two Emitters side by side."""

from tests.integration.test_modes_api import FIXED_LINE


def _emitter(client, name, rf_shift=0, save=True):
    e = client.post("/emitters", json={"name": name}).json()
    g = client.post(f"/emitters/{e['id']}/ew-groups", json={"name": "G"}).json()
    s = client.post(f"/emitters/{e['id']}/sources", json={"name": "S", "source_date": "2025-01-01"}).json()
    line = {**FIXED_LINE, "rf_min_mhz": FIXED_LINE["rf_min_mhz"] + rf_shift, "rf_max_mhz": FIXED_LINE["rf_max_mhz"] + rf_shift}
    for name_ in ("M1", "M2"):
        client.post(
            f"/ew-groups/{g['id']}/modes",
            json={"source_id": s["id"], "name": name_, "pri_type": "fixed", "line": line},
        )
    if save:
        client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"})
    return e


def test_compare_two_emitters_lists_cross_pairs_only(editor_client):
    a = _emitter(editor_client, "Compare A")
    b = _emitter(editor_client, "Compare B", rf_shift=50)
    resp = editor_client.get("/emitters/compare", params={"a": a["id"], "b": b["id"]})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["a"]["emitter_name"] == "Compare A" and len(data["a"]["modes"]) == 2
    assert data["b"]["version_number"] == 1
    # 2 x 2 Modes across the two; the pairs inside one Emitter aren't compared.
    assert len(data["findings"]) == 4
    assert all(f["details"]["mode_a"]["emitter_name"] == "Compare A" for f in data["findings"])
    assert all(f["details"]["mode_b"]["emitter_name"] == "Compare B" for f in data["findings"])
    # Two Fixed Modes are compared on jitter too, as the ambiguity check does.
    assert all(f["details"]["jitter_overlap_pct"] == 100.0 for f in data["findings"])
    assert all(f["details"]["pri_basis"] == "range" for f in data["findings"])

    far = _emitter(editor_client, "Compare Far", rf_shift=5000)
    assert editor_client.get("/emitters/compare", params={"a": a["id"], "b": far["id"]}).json()["findings"] == []


def test_compare_needs_two_different_saved_emitters(editor_client):
    a = _emitter(editor_client, "Compare Saved")
    unsaved = _emitter(editor_client, "Compare Unsaved", save=False)
    assert editor_client.get("/emitters/compare", params={"a": a["id"], "b": a["id"]}).status_code == 422
    resp = editor_client.get("/emitters/compare", params={"a": a["id"], "b": unsaved["id"]})
    assert resp.status_code == 422 and "no saved version" in resp.json()["detail"]


def test_an_emitter_against_an_older_version_of_itself(editor_client):
    e = _emitter(editor_client, "Compare Self")
    modes = {m["name"]: m for m in editor_client.get(f"/emitters/{e['id']}/modes").json()}
    group_id = modes["M1"]["ew_group_id"]
    source_id = modes["M1"]["source_id"]
    # v2: M1 widened, M2 deleted, M3 added.
    wider = {**FIXED_LINE, "rf_max_mhz": FIXED_LINE["rf_max_mhz"] + 40}
    editor_client.patch(f"/ew-groups/{group_id}/modes/{modes['M1']['id']}", json={"pri_type": "fixed", "line": wider})
    editor_client.delete(f"/ew-groups/{group_id}/modes/{modes['M2']['id']}")
    m3 = editor_client.post(
        f"/ew-groups/{group_id}/modes", json={"source_id": source_id, "name": "M3", "pri_type": "fixed", "line": FIXED_LINE}
    ).json()
    assert editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v2"}).status_code == 201

    # The latest (v2) on A, v1 on B: the changes still read from v1 to v2.
    resp = editor_client.get("/emitters/compare", params={"a": e["id"], "b": e["id"], "b_version": 1})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["same_emitter"] is True and data["findings"] == []
    assert (data["a"]["version_number"], data["b"]["version_number"]) == (2, 1)
    assert (data["from_version"], data["to_version"]) == (1, 2)
    assert set(data["changed_mode_ids"]) == {modes["M1"]["id"], modes["M2"]["id"], m3["id"]}
    kinds = {(c["scope"], c["kind"]) for c in data["changes"]["entries"]}
    assert ("Mode 'M3'", "added") in kinds and ("Mode 'M2'", "removed") in kinds and ("Mode 'M1'", "changed") in kinds
    assert data["changes"]["identical"] is False

    # Two different Emitters still say so.
    other = _emitter(editor_client, "Compare Other")
    assert editor_client.get("/emitters/compare", params={"a": e["id"], "b": other["id"]}).json()["same_emitter"] is False
    # The same version on both sides compares nothing.
    same = editor_client.get("/emitters/compare", params={"a": e["id"], "b": e["id"], "a_version": 1, "b_version": 1})
    assert same.status_code == 422 and "another version" in same.json()["detail"]
