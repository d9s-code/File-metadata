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
    "rf_range_matching": False,
    "pw_range_matching": False,
    "pri_range_matching": False,
}

STAGGER_LINE = {
    "rf_min_mhz": 2900,
    "rf_max_mhz": 3100,
    "pw_min_us": 0.5,
    "pw_max_us": 1.2,
    "rf_delta": 1,
    "pw_delta": 0.05,
    "pri_stagger_values_us": [100, 200, 300],
    "frame_time_delta_us": 15,
    "rf_range_matching": False,
    "pw_range_matching": False,
    "pri_range_matching": False,
}

CW_LINE = {
    "rf_min_mhz": 2900,
    "rf_max_mhz": 3100,
    "pw_min_us": 0.5,
    "pw_max_us": 1.2,
    "rf_delta": 1,
    "pw_delta": 0.05,
    "rf_range_matching": False,
    "pw_range_matching": False,
    "pri_range_matching": False,
}


def _setup_emitter(editor_client, name="Batch Edit Emitter"):
    emitter = editor_client.post("/emitters", json={"name": name}).json()
    ew_group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Group B"}).json()
    other_group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Group C"}).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Source B", "source_date": "2025-01-01"}
    ).json()
    fixed_mode = editor_client.post(
        f"/ew-groups/{ew_group['id']}/modes",
        json={"source_id": source["id"], "name": "Fixed Mode", "pri_type": "fixed", "line": FIXED_LINE},
    ).json()
    stagger_mode = editor_client.post(
        f"/ew-groups/{ew_group['id']}/modes",
        json={"source_id": source["id"], "name": "Stagger Mode", "pri_type": "stagger", "line": STAGGER_LINE},
    ).json()
    cw_mode = editor_client.post(
        f"/ew-groups/{ew_group['id']}/modes",
        json={"source_id": source["id"], "name": "CW Mode", "pri_type": "cw", "line": CW_LINE},
    ).json()
    return {
        "emitter": emitter,
        "ew_group": ew_group,
        "other_group": other_group,
        "source": source,
        "fixed_mode": fixed_mode,
        "stagger_mode": stagger_mode,
        "cw_mode": cw_mode,
    }


def test_batch_field_edit_sets_range_matching_and_delta(editor_client):
    ctx = _setup_emitter(editor_client)
    emitter_id = ctx["emitter"]["id"]
    resp = editor_client.post(
        f"/emitters/{emitter_id}/modes/batch-edit",
        json={
            "mode_ids": [ctx["fixed_mode"]["id"], ctx["cw_mode"]["id"]],
            "fields": {"rf_range_matching": True, "rf_delta": 2},
        },
    )
    assert resp.status_code == 200, resp.text
    assert set(resp.json()["updated_mode_ids"]) == {ctx["fixed_mode"]["id"], ctx["cw_mode"]["id"]}

    modes = {m["id"]: m for m in editor_client.get(f"/emitters/{emitter_id}/modes").json()}
    assert modes[ctx["fixed_mode"]["id"]]["line"]["rf_range_matching"] is True
    assert modes[ctx["fixed_mode"]["id"]]["line"]["rf_delta"] == 2
    assert modes[ctx["cw_mode"]["id"]]["line"]["rf_range_matching"] is True
    # Untouched mode stays untouched.
    assert modes[ctx["stagger_mode"]["id"]]["line"]["rf_range_matching"] is False


def test_batch_field_edit_reassigns_ew_group(editor_client):
    ctx = _setup_emitter(editor_client)
    emitter_id = ctx["emitter"]["id"]
    resp = editor_client.post(
        f"/emitters/{emitter_id}/modes/batch-edit",
        json={"mode_ids": [ctx["fixed_mode"]["id"]], "fields": {"ew_group_id": ctx["other_group"]["id"]}},
    )
    assert resp.status_code == 200, resp.text
    modes = {m["id"]: m for m in editor_client.get(f"/emitters/{emitter_id}/modes").json()}
    assert modes[ctx["fixed_mode"]["id"]]["ew_group_id"] == ctx["other_group"]["id"]


def test_batch_edit_rejects_whole_batch_on_any_invalid_result(editor_client):
    ctx = _setup_emitter(editor_client)
    emitter_id = ctx["emitter"]["id"]
    # pri_delta is valid for a Fixed-PRI Mode but forbidden for CW — applying
    # it to both in one batch must reject the whole thing, including the
    # Fixed Mode's otherwise-valid change.
    resp = editor_client.post(
        f"/emitters/{emitter_id}/modes/batch-edit",
        json={
            "mode_ids": [ctx["fixed_mode"]["id"], ctx["cw_mode"]["id"]],
            "fields": {"pri_delta": 5},
        },
    )
    assert resp.status_code == 422, resp.text
    errors = resp.json()["detail"]
    assert len(errors) == 1
    assert errors[0]["mode_id"] == ctx["cw_mode"]["id"]

    # Nothing was written, not even to the mode that would have been fine.
    modes = {m["id"]: m for m in editor_client.get(f"/emitters/{emitter_id}/modes").json()}
    assert modes[ctx["fixed_mode"]["id"]]["line"]["pri_delta"] == 10


def test_batch_edit_unknown_mode_id_is_404(editor_client):
    ctx = _setup_emitter(editor_client)
    emitter_id = ctx["emitter"]["id"]
    resp = editor_client.post(
        f"/emitters/{emitter_id}/modes/batch-edit",
        json={"mode_ids": ["00000000-0000-0000-0000-000000000000"], "fields": {"rf_range_matching": True}},
    )
    assert resp.status_code == 404


def test_batch_edit_mode_from_another_emitter_is_404(editor_client):
    ctx = _setup_emitter(editor_client, name="Batch Edit Emitter A")
    other = _setup_emitter(editor_client, name="Batch Edit Emitter B")
    resp = editor_client.post(
        f"/emitters/{ctx['emitter']['id']}/modes/batch-edit",
        json={"mode_ids": [other["fixed_mode"]["id"]], "fields": {"rf_range_matching": True}},
    )
    assert resp.status_code == 404


def test_batch_edit_requires_checkout(editor_client, admin_client):
    ctx = _setup_emitter(editor_client)
    resp = admin_client.post(
        f"/emitters/{ctx['emitter']['id']}/modes/batch-edit",
        json={"mode_ids": [ctx["fixed_mode"]["id"]], "fields": {"rf_range_matching": True}},
    )
    assert resp.status_code == 409


def test_batch_shift_applies_signed_offset_independently_per_bound(editor_client):
    ctx = _setup_emitter(editor_client)
    emitter_id = ctx["emitter"]["id"]
    resp = editor_client.post(
        f"/emitters/{emitter_id}/modes/batch-edit",
        json={
            "mode_ids": [ctx["fixed_mode"]["id"]],
            "fields": {"rf_min_shift": 50, "rf_max_shift": -25},
            "shift_reason": "Recalibrated per updated ELINT report",
        },
    )
    assert resp.status_code == 200, resp.text

    modes = {m["id"]: m for m in editor_client.get(f"/emitters/{emitter_id}/modes").json()}
    line = modes[ctx["fixed_mode"]["id"]]["line"]
    assert line["rf_min_mhz"] == 2950  # 2900 + 50
    assert line["rf_max_mhz"] == 3075  # 3100 - 25
    # Untouched bound (pw) stays untouched.
    assert line["pw_min_us"] == 0.5


def test_batch_shift_without_reason_is_rejected(editor_client):
    ctx = _setup_emitter(editor_client)
    emitter_id = ctx["emitter"]["id"]
    resp = editor_client.post(
        f"/emitters/{emitter_id}/modes/batch-edit",
        json={"mode_ids": [ctx["fixed_mode"]["id"]], "fields": {"rf_min_shift": 50}},
    )
    assert resp.status_code == 422, resp.text

    # Blank/whitespace-only reason is rejected the same way.
    resp = editor_client.post(
        f"/emitters/{emitter_id}/modes/batch-edit",
        json={"mode_ids": [ctx["fixed_mode"]["id"]], "fields": {"rf_min_shift": 50}, "shift_reason": "   "},
    )
    assert resp.status_code == 422, resp.text

    # Nothing was written.
    modes = {m["id"]: m for m in editor_client.get(f"/emitters/{emitter_id}/modes").json()}
    assert modes[ctx["fixed_mode"]["id"]]["line"]["rf_min_mhz"] == 2900


def test_batch_shift_on_nonexistent_bound_is_a_no_op_not_an_error(editor_client):
    ctx = _setup_emitter(editor_client)
    emitter_id = ctx["emitter"]["id"]
    # cw_mode has no pri_min_us/pri_max_us at all — shifting it must not error.
    resp = editor_client.post(
        f"/emitters/{emitter_id}/modes/batch-edit",
        json={
            "mode_ids": [ctx["cw_mode"]["id"]],
            "fields": {"pri_min_shift": 10},
            "shift_reason": "testing no-op",
        },
    )
    assert resp.status_code == 200, resp.text
    modes = {m["id"]: m for m in editor_client.get(f"/emitters/{emitter_id}/modes").json()}
    assert modes[ctx["cw_mode"]["id"]]["line"]["pri_min_us"] is None


def test_batch_edit_requires_fields(editor_client):
    ctx = _setup_emitter(editor_client)
    resp = editor_client.post(
        f"/emitters/{ctx['emitter']['id']}/modes/batch-edit",
        json={"mode_ids": [ctx["fixed_mode"]["id"]]},
    )
    assert resp.status_code == 422
