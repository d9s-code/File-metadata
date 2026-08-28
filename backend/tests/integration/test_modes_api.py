import pytest


@pytest.fixture()
def emitter_ctx(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Ctx Emitter"}).json()
    ew_group = editor_client.post(
        f"/emitters/{emitter['id']}/ew-groups",
        json={"name": "Track Group", "scan_min": 1.0, "scan_max": 2.0, "threat_priority": 5},
    ).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources",
        json={"name": "ELINT 001", "source_date": "2025-01-15"},
    ).json()
    return {"emitter": emitter, "ew_group": ew_group, "source": source}


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
}


def test_create_fixed_mode_requires_jitter(editor_client, emitter_ctx):
    line = {k: v for k, v in FIXED_LINE.items() if k not in ("jitter_min_us", "jitter_max_us")}
    resp = editor_client.post(
        f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes",
        json={"source_id": emitter_ctx["source"]["id"], "name": "Bad Fixed", "pri_type": "fixed", "line": line},
    )
    assert resp.status_code == 422


def test_create_fixed_mode_succeeds_with_jitter(editor_client, emitter_ctx):
    resp = editor_client.post(
        f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes",
        json={"source_id": emitter_ctx["source"]["id"], "name": "Good Fixed", "pri_type": "fixed", "line": FIXED_LINE},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["line"]["jitter_min_us"] == 5
    assert body["line"]["pri_stagger_values_us"] is None


def test_create_manual_mode_requires_deltas(editor_client, emitter_ctx):
    line = {k: v for k, v in FIXED_LINE.items() if k not in ("rf_delta", "pw_delta", "pri_delta")}
    resp = editor_client.post(
        f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes",
        json={"source_id": emitter_ctx["source"]["id"], "name": "No Delta", "pri_type": "fixed", "line": line},
    )
    assert resp.status_code == 422


def test_create_fixed_mode_computes_engineered_range(editor_client, emitter_ctx):
    resp = editor_client.post(
        f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes",
        json={"source_id": emitter_ctx["source"]["id"], "name": "Engineered", "pri_type": "fixed", "line": FIXED_LINE},
    )
    assert resp.status_code == 201, resp.text
    line_out = resp.json()["line"]
    assert line_out["engineered_rf_min_mhz"] == 2899
    assert line_out["engineered_rf_max_mhz"] == 3101
    assert line_out["engineered_pw_min_us"] == pytest.approx(0.45)
    assert line_out["engineered_pw_max_us"] == pytest.approx(1.25)
    assert line_out["engineered_pri_min_us"] == 790
    assert line_out["engineered_pri_max_us"] == 1210


def test_create_stagger_mode_rejects_fixed_fields(editor_client, emitter_ctx):
    line = {
        "rf_min_mhz": 2900,
        "rf_max_mhz": 3100,
        "pw_min_us": 0.5,
        "pw_max_us": 1.2,
        "pri_min_us": 800,
        "pri_stagger_values_us": [800, 850, 900],
    }
    resp = editor_client.post(
        f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes",
        json={"source_id": emitter_ctx["source"]["id"], "name": "Bad Stagger", "pri_type": "stagger", "line": line},
    )
    assert resp.status_code == 422


def test_create_stagger_mode_preserves_sequence_order(editor_client, emitter_ctx):
    sequence = [800, 850, 900, 780]
    line = {
        "rf_min_mhz": 2900,
        "rf_max_mhz": 3100,
        "pw_min_us": 0.5,
        "pw_max_us": 1.2,
        "rf_delta": 1,
        "pw_delta": 0.05,
        "pri_stagger_values_us": sequence,
    }
    resp = editor_client.post(
        f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes",
        json={"source_id": emitter_ctx["source"]["id"], "name": "Stagger", "pri_type": "stagger", "line": line},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["line"]["pri_stagger_values_us"] == sequence


def test_create_cw_mode_rejects_any_pri_value(editor_client, emitter_ctx):
    line = {"rf_min_mhz": 2900, "rf_max_mhz": 3100, "pw_min_us": 0.5, "pw_max_us": 1.2, "pri_min_us": 800}
    resp = editor_client.post(
        f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes",
        json={"source_id": emitter_ctx["source"]["id"], "name": "Bad CW", "pri_type": "cw", "line": line},
    )
    assert resp.status_code == 422


def test_mode_rejects_source_from_a_different_emitter(editor_client, emitter_ctx):
    other_emitter = editor_client.post("/emitters", json={"name": "Other Emitter"}).json()
    other_source = editor_client.post(
        f"/emitters/{other_emitter['id']}/sources",
        json={"name": "Other Source", "source_date": "2025-01-01"},
    ).json()

    resp = editor_client.post(
        f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes",
        json={"source_id": other_source["id"], "name": "Cross Emitter", "pri_type": "fixed", "line": FIXED_LINE},
    )
    assert resp.status_code == 422


def test_list_emitter_modes_spans_all_ew_groups(editor_client, emitter_ctx):
    other_group = editor_client.post(
        f"/emitters/{emitter_ctx['emitter']['id']}/ew-groups", json={"name": "Search Group"}
    ).json()

    editor_client.post(
        f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes",
        json={"source_id": emitter_ctx["source"]["id"], "name": "In Track Group", "pri_type": "fixed", "line": FIXED_LINE},
    )
    editor_client.post(
        f"/ew-groups/{other_group['id']}/modes",
        json={"source_id": emitter_ctx["source"]["id"], "name": "In Search Group", "pri_type": "fixed", "line": FIXED_LINE},
    )

    resp = editor_client.get(f"/emitters/{emitter_ctx['emitter']['id']}/modes")
    assert resp.status_code == 200, resp.text
    names = {m["name"] for m in resp.json()}
    assert names == {"In Track Group", "In Search Group"}
    ew_group_ids = {m["ew_group_id"] for m in resp.json()}
    assert ew_group_ids == {emitter_ctx["ew_group"]["id"], other_group["id"]}


def test_source_with_modes_cannot_be_deleted(editor_client, emitter_ctx):
    editor_client.post(
        f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes",
        json={"source_id": emitter_ctx["source"]["id"], "name": "Blocks Delete", "pri_type": "fixed", "line": FIXED_LINE},
    )
    resp = editor_client.delete(
        f"/emitters/{emitter_ctx['emitter']['id']}/sources/{emitter_ctx['source']['id']}"
    )
    assert resp.status_code == 409
