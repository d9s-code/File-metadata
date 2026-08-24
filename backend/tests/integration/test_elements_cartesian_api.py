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
