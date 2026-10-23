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
