"""Cartesian product with PRI type Stagger: the picked PRI Elements in their
firing order (a range at its mean), or a picked sequence's PRI steps in
step order, make one stagger train crossed with the RF and PW Elements."""

import pytest


@pytest.fixture()
def ctx(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Stagger Emitter"}).json()
    ew_group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Group S"}).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Source S", "source_date": "2025-02-01"}
    ).json()
    base = f"/emitters/{emitter['id']}/sources/{source['id']}"
    return {"emitter": emitter, "ew_group": ew_group, "source": source, "base": base}


def _el(client, ctx, **body):
    resp = client.post(f"{ctx['base']}/elements", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _run(client, ctx, **body):
    payload = {
        "ew_group_id": ctx["ew_group"]["id"],
        "rf_element_ids": [],
        "pw_element_ids": [],
        "pri_element_ids": [],
        "name_prefix": "Stg",
        "pri_type": "stagger",
        **body,
    }
    return client.post(f"{ctx['base']}/elements/cartesian-product", json=payload)


def _modes(client, ctx):
    return client.get(f"/ew-groups/{ctx['ew_group']['id']}/modes").json()


def test_stagger_from_elements_follows_firing_order_and_uses_range_means(editor_client, ctx):
    rf1 = _el(editor_client, ctx, element_type="rf", value_min=2900, value_max=3100)
    rf2 = _el(editor_client, ctx, element_type="rf", value_min=5000, value_max=5000)
    pw = _el(editor_client, ctx, element_type="pw", value_min=1, value_max=1)
    a = _el(editor_client, ctx, element_type="pri", value_min=800, value_max=800)
    b = _el(editor_client, ctx, element_type="pri", value_min=900, value_max=1000)

    resp = _run(
        editor_client,
        ctx,
        rf_element_ids=[rf1["id"], rf2["id"]],
        pw_element_ids=[pw["id"]],
        pri_element_ids=[a["id"], b["id"]],
        # b fires first and third; a second.
        pri_firing_order={b["id"]: [1, 3], a["id"]: [2]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["count"] == 2  # 2 RF x 1 PW x one train

    modes = _modes(editor_client, ctx)
    assert {m["pri_type"] for m in modes} == {"stagger"}
    for m in modes:
        assert m["line"]["pri_stagger_values_us"] == [950, 800, 950]
        # Elements carry no frame-time margin: the default one (3 µs).
        assert m["line"]["frame_time_delta_us"] == 3
        assert m["line"]["pri_delta"] is None
    assert sorted(m["line"]["rf_min_mhz"] for m in modes) == [2900, 5000]


def test_stagger_firing_order_must_be_complete(editor_client, ctx):
    a = _el(editor_client, ctx, element_type="pri", value_min=800, value_max=800)
    b = _el(editor_client, ctx, element_type="pri", value_min=900, value_max=900)

    missing = _run(editor_client, ctx, pri_element_ids=[a["id"], b["id"]], pri_firing_order={a["id"]: [1]})
    assert missing.status_code == 422
    assert "firing order" in missing.json()["detail"]

    clash = _run(
        editor_client, ctx, pri_element_ids=[a["id"], b["id"]], pri_firing_order={a["id"]: [1], b["id"]: [1]}
    )
    assert clash.status_code == 422
    assert "both fire at position 1" in clash.json()["detail"]

    gap = _run(
        editor_client, ctx, pri_element_ids=[a["id"], b["id"]], pri_firing_order={a["id"]: [1], b["id"]: [3]}
    )
    assert gap.status_code == 422
    assert "nothing fires at 2" in gap.json()["detail"]
    assert _modes(editor_client, ctx) == []


def test_stagger_from_sequence_uses_its_step_order(editor_client, ctx):
    seq = editor_client.post(
        f"{ctx['base']}/parameter-sequences",
        json={
            "label": "Train",
            "steps": [
                {"order": 2, "pri_us": 700, "rf_mhz": 3100},
                {"order": 0, "pri_us": 500, "rf_mhz": 3000},
                {"order": 1, "pri_min_us": 600, "pri_max_us": 620, "rf_mhz": 3050},
            ],
            "rf_delta": 4,
        },
    ).json()
    resp = _run(
        editor_client,
        ctx,
        sequence_steps=[{"sequence_id": seq["id"], "order": o} for o in (2, 0, 1)],
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["count"] == 1

    (mode,) = _modes(editor_client, ctx)
    assert mode["pri_type"] == "stagger"
    assert mode["line"]["pri_stagger_values_us"] == [500, 610, 700]
    # No RF Element picked: the RF its steps span.
    assert (mode["line"]["rf_min_mhz"], mode["line"]["rf_max_mhz"]) == (3000, 3100)
    assert mode["line"]["rf_delta"] == 4


def test_stagger_rejects_sequence_without_pri_and_mixing_with_elements(editor_client, ctx):
    seq = editor_client.post(
        f"{ctx['base']}/parameter-sequences",
        json={"label": "RF only", "steps": [{"order": 0, "rf_mhz": 3000}]},
    ).json()
    no_pri = _run(editor_client, ctx, sequence_steps=[{"sequence_id": seq["id"], "order": 0}])
    assert no_pri.status_code == 422
    assert "no PRI" in no_pri.json()["detail"]

    a = _el(editor_client, ctx, element_type="pri", value_min=800, value_max=800)
    both = _run(
        editor_client,
        ctx,
        pri_element_ids=[a["id"]],
        pri_firing_order={a["id"]: [1]},
        sequence_steps=[{"sequence_id": seq["id"], "order": 0}],
    )
    assert both.status_code == 422
    assert "not both" in both.json()["detail"]

    nothing = _run(editor_client, ctx)
    assert nothing.status_code == 422


def test_fixed_stays_the_default(editor_client, ctx):
    a = _el(editor_client, ctx, element_type="pri", value_min=800, value_max=900, jitter_min=0, jitter_max=1)
    b = _el(editor_client, ctx, element_type="pri", value_min=1000, value_max=1000, jitter_min=0, jitter_max=1)
    resp = editor_client.post(
        f"{ctx['base']}/elements/cartesian-product",
        json={
            "ew_group_id": ctx["ew_group"]["id"],
            "rf_element_ids": [],
            "pw_element_ids": [],
            "pri_element_ids": [a["id"], b["id"]],
            "name_prefix": "Fx",
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["count"] == 2
    assert {m["pri_type"] for m in _modes(editor_client, ctx)} == {"fixed"}


def test_all_sources_stagger_and_run_log(editor_client, ctx):
    a = _el(editor_client, ctx, element_type="pri", value_min=800, value_max=800)
    b = _el(editor_client, ctx, element_type="pri", value_min=900, value_max=900)
    resp = editor_client.post(
        f"/emitters/{ctx['emitter']['id']}/sources/all-sources/cartesian-product",
        json={
            "ew_group_id": ctx["ew_group"]["id"],
            "rf_element_ids": [],
            "pw_element_ids": [],
            "pri_element_ids": [a["id"], b["id"]],
            "name_prefix": "All",
            "pri_type": "stagger",
            "pri_firing_order": {a["id"]: [2], b["id"]: [1]},
        },
    )
    assert resp.status_code == 200, resp.text
    (mode,) = _modes(editor_client, ctx)
    assert mode["line"]["pri_stagger_values_us"] == [900, 800]

    runs = editor_client.get(f"{ctx['base']}/cartesian-runs").json()
    assert runs[0]["inputs"]["pri_type"] == "stagger"
    orders = {e["value_min"]: e["firing_order"] for e in runs[0]["inputs"]["elements"]}
    assert orders == {800: [2], 900: [1]}


def test_a_single_mode_is_named_by_the_prefix_alone(editor_client, ctx):
    pri = _el(editor_client, ctx, element_type="pri", value_min=800, value_max=800, jitter_min=0, jitter_max=1)
    run = lambda: editor_client.post(  # noqa: E731
        f"{ctx['base']}/elements/cartesian-product",
        json={
            "ew_group_id": ctx["ew_group"]["id"],
            "rf_element_ids": [],
            "pw_element_ids": [],
            "pri_element_ids": [pri["id"]],
            "name_prefix": "Search",
        },
    )
    assert run().status_code == 200
    # Taken already: numbered instead.
    assert run().status_code == 200
    assert sorted(m["name"] for m in _modes(editor_client, ctx)) == ["Search", "Search 1"]

    # More than one: numbered from 1 as before.
    other = _el(editor_client, ctx, element_type="pri", value_min=900, value_max=900, jitter_min=0, jitter_max=1)
    editor_client.post(
        f"{ctx['base']}/elements/cartesian-product",
        json={
            "ew_group_id": ctx["ew_group"]["id"],
            "rf_element_ids": [],
            "pw_element_ids": [],
            "pri_element_ids": [pri["id"], other["id"]],
            "name_prefix": "Track",
        },
    )
    assert sorted(m["name"] for m in _modes(editor_client, ctx) if m["name"].startswith("Track")) == [
        "Track 1",
        "Track 2",
    ]
