import pytest


@pytest.fixture()
def emitter_ctx(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Cartesian Emitter"}).json()
    ew_group = editor_client.post(
        f"/emitters/{emitter['id']}/ew-groups", json={"name": "Group A"}
    ).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources",
        json={"name": "Source A", "source_date": "2025-02-01"},
    ).json()
    return {"emitter": emitter, "ew_group": ew_group, "source": source}


def _elements_url(ctx):
    return f"/emitters/{ctx['emitter']['id']}/sources/{ctx['source']['id']}/elements"


def test_create_pri_element_rejects_range_and_stagger_together(editor_client, emitter_ctx):
    resp = editor_client.post(
        _elements_url(emitter_ctx),
        json={"element_type": "pri", "value_min": 800, "value_max": 1200, "stagger_values": [1, 2, 3]},
    )
    assert resp.status_code == 422


def test_create_fixed_style_pri_element(editor_client, emitter_ctx):
    resp = editor_client.post(
        _elements_url(emitter_ctx),
        json={"element_type": "pri", "value_min": 800, "value_max": 1200, "jitter_min": 5, "jitter_max": 15},
    )
    assert resp.status_code == 201, resp.text


def test_frametime_sums_stagger_sequence(editor_client, emitter_ctx):
    element = editor_client.post(
        _elements_url(emitter_ctx),
        json={"element_type": "pri", "stagger_values": [800, 850, 900, 780]},
    ).json()
    resp = editor_client.get(f"{_elements_url(emitter_ctx)}/{element['id']}/frametime")
    assert resp.status_code == 200
    assert resp.json()["frametime_us"] == 800 + 850 + 900 + 780


def test_frametime_rejects_non_stagger_element(editor_client, emitter_ctx):
    element = editor_client.post(
        _elements_url(emitter_ctx), json={"element_type": "rf", "value_min": 2900, "value_max": 3100}
    ).json()
    resp = editor_client.get(f"{_elements_url(emitter_ctx)}/{element['id']}/frametime")
    assert resp.status_code == 422


def test_cartesian_product_generates_nxmxk_modes(editor_client, emitter_ctx):
    url = _elements_url(emitter_ctx)
    rf1 = editor_client.post(url, json={"element_type": "rf", "value_min": 2900, "value_max": 3100}).json()
    rf2 = editor_client.post(url, json={"element_type": "rf", "value_min": 4900, "value_max": 5100}).json()
    pw1 = editor_client.post(url, json={"element_type": "pw", "value_min": 0.5, "value_max": 1.2}).json()
    pri1 = editor_client.post(
        url, json={"element_type": "pri", "value_min": 800, "value_max": 1200, "jitter_min": 5, "jitter_max": 15}
    ).json()
    pri2 = editor_client.post(
        url, json={"element_type": "pri", "value_min": 600, "value_max": 900, "jitter_min": 2, "jitter_max": 8}
    ).json()

    resp = editor_client.post(
        f"{url}/cartesian-product",
        json={
            "ew_group_id": emitter_ctx["ew_group"]["id"],
            "rf_element_ids": [rf1["id"], rf2["id"]],
            "pw_element_ids": [pw1["id"]],
            "pri_element_ids": [pri1["id"], pri2["id"]],
            "name_prefix": "Gen",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # 2 RF x 1 PW x 2 PRI = 4
    assert body["count"] == 4
    assert len(body["created_mode_ids"]) == 4

    modes = editor_client.get(f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes").json()
    assert len(modes) == 4
    assert all(m["source_id"] == emitter_ctx["source"]["id"] for m in modes)
    assert all(m["line"]["dsl_text"] for m in modes)


def test_create_element_rejects_negative_delta(editor_client, emitter_ctx):
    resp = editor_client.post(
        _elements_url(emitter_ctx),
        json={"element_type": "rf", "value_min": 2900, "value_max": 3100, "delta": -5},
    )
    assert resp.status_code == 422


def test_create_element_rejects_delta_on_stagger_pri(editor_client, emitter_ctx):
    resp = editor_client.post(
        _elements_url(emitter_ctx),
        json={"element_type": "pri", "stagger_values": [800, 850, 900], "delta": 5},
    )
    assert resp.status_code == 422


def test_element_response_includes_engineered_range(editor_client, emitter_ctx):
    element = editor_client.post(
        _elements_url(emitter_ctx),
        json={"element_type": "rf", "value_min": 2900, "value_max": 3100, "delta": 5},
    ).json()
    assert element["engineered_min"] == 2895
    assert element["engineered_max"] == 3105

    element_no_delta = editor_client.post(
        _elements_url(emitter_ctx), json={"element_type": "rf", "value_min": 4900, "value_max": 5100}
    ).json()
    assert element_no_delta["engineered_min"] == 4900
    assert element_no_delta["engineered_max"] == 5100


def test_ew_group_response_includes_engineered_scan_range(editor_client, emitter_ctx):
    resp = editor_client.patch(
        f"/emitters/{emitter_ctx['emitter']['id']}/ew-groups/{emitter_ctx['ew_group']['id']}",
        json={"scan_min": 2000, "scan_max": 4000, "scan_delta": 100},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["engineered_scan_min"] == 1900
    assert body["engineered_scan_max"] == 4100


def test_cartesian_product_writes_engineered_values_into_mode_line(editor_client, emitter_ctx):
    url = _elements_url(emitter_ctx)
    rf1 = editor_client.post(url, json={"element_type": "rf", "value_min": 2900, "value_max": 3100, "delta": 10}).json()
    pw1 = editor_client.post(url, json={"element_type": "pw", "value_min": 0.5, "value_max": 1.2}).json()
    pri1 = editor_client.post(
        url,
        json={
            "element_type": "pri",
            "value_min": 800,
            "value_max": 1200,
            "jitter_min": 5,
            "jitter_max": 15,
            "delta": 20,
        },
    ).json()

    resp = editor_client.post(
        f"{url}/cartesian-product",
        json={
            "ew_group_id": emitter_ctx["ew_group"]["id"],
            "rf_element_ids": [rf1["id"]],
            "pw_element_ids": [pw1["id"]],
            "pri_element_ids": [pri1["id"]],
            "name_prefix": "Engineered",
        },
    )
    assert resp.status_code == 200, resp.text

    modes = editor_client.get(f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes").json()
    assert len(modes) == 1
    line = modes[0]["line"]
    # RF/PRI widened by their delta; PW has no delta so it stays exactly as typed.
    assert line["rf_min_mhz"] == 2890
    assert line["rf_max_mhz"] == 3110
    assert line["pw_min_us"] == 0.5
    assert line["pw_max_us"] == 1.2
    assert line["pri_min_us"] == 780
    assert line["pri_max_us"] == 1220


def test_cartesian_product_rejects_mixed_pri_shapes(editor_client, emitter_ctx):
    url = _elements_url(emitter_ctx)
    rf1 = editor_client.post(url, json={"element_type": "rf", "value_min": 2900, "value_max": 3100}).json()
    pw1 = editor_client.post(url, json={"element_type": "pw", "value_min": 0.5, "value_max": 1.2}).json()
    pri_fixed = editor_client.post(
        url, json={"element_type": "pri", "value_min": 800, "value_max": 1200, "jitter_min": 5, "jitter_max": 15}
    ).json()
    pri_stagger = editor_client.post(url, json={"element_type": "pri", "stagger_values": [1, 2, 3]}).json()

    resp = editor_client.post(
        f"{url}/cartesian-product",
        json={
            "ew_group_id": emitter_ctx["ew_group"]["id"],
            "rf_element_ids": [rf1["id"]],
            "pw_element_ids": [pw1["id"]],
            "pri_element_ids": [pri_fixed["id"], pri_stagger["id"]],
        },
    )
    assert resp.status_code == 422


def test_create_mode_from_dsl_derives_elements(editor_client, emitter_ctx):
    resp = editor_client.post(
        f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes/from-dsl",
        json={
            "source_id": emitter_ctx["source"]["id"],
            "name": "Typed Mode",
            "dsl_text": "RF 2900-3100 PRI FIXED 800-1200 JITTER 5-15 PW 0.5-1.2",
        },
    )
    assert resp.status_code == 201, resp.text
    mode = resp.json()
    assert mode["pri_type"] == "fixed"
    assert mode["line"]["rf_min_mhz"] == 2900

    elements = editor_client.get(_elements_url(emitter_ctx)).json()
    types = {e["element_type"] for e in elements}
    assert types == {"rf", "pw", "pri"}


def test_create_mode_from_dsl_rejects_invalid_syntax(editor_client, emitter_ctx):
    resp = editor_client.post(
        f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes/from-dsl",
        json={"source_id": emitter_ctx["source"]["id"], "name": "Bad", "dsl_text": "not a mode line"},
    )
    assert resp.status_code == 422


def test_cartesian_product_creates_generation_batch(editor_client, emitter_ctx):
    url = _elements_url(emitter_ctx)
    rf1 = editor_client.post(url, json={"element_type": "rf", "value_min": 2900, "value_max": 3100}).json()
    pw1 = editor_client.post(url, json={"element_type": "pw", "value_min": 0.5, "value_max": 1.2}).json()
    pri1 = editor_client.post(
        url, json={"element_type": "pri", "value_min": 800, "value_max": 1200, "jitter_min": 5, "jitter_max": 15}
    ).json()

    resp = editor_client.post(
        f"{url}/cartesian-product",
        json={
            "ew_group_id": emitter_ctx["ew_group"]["id"],
            "rf_element_ids": [rf1["id"]],
            "pw_element_ids": [pw1["id"]],
            "pri_element_ids": [pri1["id"]],
            "name_prefix": "Batch1",
        },
    )
    assert resp.status_code == 200, resp.text

    modes = editor_client.get(f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes").json()
    assert len(modes) == 1
    batch_id = modes[0]["generation_batch_id"]
    assert batch_id is not None

    batches = editor_client.get(f"/emitters/{emitter_ctx['emitter']['id']}/generation-batches").json()
    assert len(batches) == 1
    assert batches[0]["id"] == batch_id
    assert batches[0]["name_prefix"] == "Batch1"
    assert batches[0]["mode_count"] == 1


def test_repeated_cartesian_product_runs_do_not_collide_on_sort_order(editor_client, emitter_ctx):
    url = _elements_url(emitter_ctx)
    rf1 = editor_client.post(url, json={"element_type": "rf", "value_min": 2900, "value_max": 3100}).json()
    rf2 = editor_client.post(url, json={"element_type": "rf", "value_min": 4900, "value_max": 5100}).json()
    pw1 = editor_client.post(url, json={"element_type": "pw", "value_min": 0.5, "value_max": 1.2}).json()
    pri1 = editor_client.post(
        url, json={"element_type": "pri", "value_min": 800, "value_max": 1200, "jitter_min": 5, "jitter_max": 15}
    ).json()

    for prefix in ("RunA", "RunB"):
        resp = editor_client.post(
            f"{url}/cartesian-product",
            json={
                "ew_group_id": emitter_ctx["ew_group"]["id"],
                "rf_element_ids": [rf1["id"], rf2["id"]],
                "pw_element_ids": [pw1["id"]],
                "pri_element_ids": [pri1["id"]],
                "name_prefix": prefix,
            },
        )
        assert resp.status_code == 200, resp.text

    modes = editor_client.get(f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes").json()
    assert len(modes) == 4
    sort_orders = [m["sort_order"] for m in modes]
    assert len(sort_orders) == len(set(sort_orders))  # no collisions across the two runs

    batches = editor_client.get(f"/emitters/{emitter_ctx['emitter']['id']}/generation-batches").json()
    assert len(batches) == 2
    assert {b["mode_count"] for b in batches} == {2}


def test_delete_generation_batch_removes_its_modes(editor_client, emitter_ctx):
    url = _elements_url(emitter_ctx)
    rf1 = editor_client.post(url, json={"element_type": "rf", "value_min": 2900, "value_max": 3100}).json()
    pw1 = editor_client.post(url, json={"element_type": "pw", "value_min": 0.5, "value_max": 1.2}).json()
    pri1 = editor_client.post(
        url, json={"element_type": "pri", "value_min": 800, "value_max": 1200, "jitter_min": 5, "jitter_max": 15}
    ).json()

    editor_client.post(
        f"{url}/cartesian-product",
        json={
            "ew_group_id": emitter_ctx["ew_group"]["id"],
            "rf_element_ids": [rf1["id"]],
            "pw_element_ids": [pw1["id"]],
            "pri_element_ids": [pri1["id"]],
            "name_prefix": "ToDelete",
        },
    )
    batch = editor_client.get(f"/emitters/{emitter_ctx['emitter']['id']}/generation-batches").json()[0]

    resp = editor_client.delete(f"/emitters/{emitter_ctx['emitter']['id']}/generation-batches/{batch['id']}")
    assert resp.status_code == 204

    modes = editor_client.get(f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes").json()
    assert modes == []
    batches = editor_client.get(f"/emitters/{emitter_ctx['emitter']['id']}/generation-batches").json()
    assert batches == []


def test_dsl_parse_and_render_endpoints(viewer_client):
    resp = viewer_client.post("/dsl/parse", json={"text": "RF 2900-3100 PRI CW PW 0.5-1.2"})
    assert resp.status_code == 200
    assert resp.json()["pri_type"] == "cw"

    resp = viewer_client.post(
        "/dsl/render",
        json={"pri_type": "cw", "rf_min_mhz": 2900, "rf_max_mhz": 3100, "pw_min_us": 0.5, "pw_max_us": 1.2},
    )
    assert resp.status_code == 200
    assert resp.json()["text"] == "RF 2900-3100 PRI CW PW 0.5-1.2"
