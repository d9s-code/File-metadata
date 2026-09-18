import pytest


@pytest.fixture()
def emitter_ctx(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Intercept Ctx Emitter"}).json()
    ew_group = editor_client.post(
        f"/emitters/{emitter['id']}/ew-groups",
        json={"name": "Track Group", "scan_min": 1.0, "scan_max": 2.0, "threat_priority": 5},
    ).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources",
        json={"name": "ELINT 001", "source_date": "2025-01-15"},
    ).json()
    return {"emitter": emitter, "ew_group": ew_group, "source": source}


FIXED_ENTRY = {
    "pri_type": "fixed",
    "rf_mean_mhz": 3000,
    "pw_mean_us": 1.0,
    "pri_mean_us": 1000,
    "jitter_mean_us": 10,
}

STAGGER_ENTRY = {
    "pri_type": "stagger",
    "rf_mean_mhz": 3000,
    "pw_mean_us": 1.0,
    "pri_mean_us": 950,
    "stagger_values": [800, 850, 900, 780],
}

MODE_LINE = {
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


def _create_intercept(editor_client, emitter_id, name="Morning Pass"):
    return editor_client.post("/intercepts", json={"emitter_id": emitter_id, "name": name}).json()


def test_create_list_get_update_delete_intercept(editor_client, emitter_ctx):
    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])
    assert intercept["name"] == "Morning Pass"
    assert intercept["entry_count"] == 0

    resp = editor_client.get("/intercepts")
    assert resp.status_code == 200, resp.text
    assert any(i["id"] == intercept["id"] for i in resp.json())

    resp = editor_client.get(f"/intercepts/{intercept['id']}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Morning Pass"

    resp = editor_client.patch(f"/intercepts/{intercept['id']}", json={"name": "Afternoon Pass"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Afternoon Pass"

    resp = editor_client.delete(f"/intercepts/{intercept['id']}")
    assert resp.status_code == 204, resp.text
    assert editor_client.get(f"/intercepts/{intercept['id']}").status_code == 404


def test_create_intercept_requires_known_emitter(editor_client):
    resp = editor_client.post("/intercepts", json={"emitter_id": "00000000-0000-0000-0000-000000000000", "name": "X"})
    assert resp.status_code == 404


def test_viewer_cannot_mutate_intercepts(viewer_client, editor_client, emitter_ctx):
    resp = viewer_client.post("/intercepts", json={"emitter_id": emitter_ctx["emitter"]["id"], "name": "Nope"})
    assert resp.status_code == 403

    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])
    assert viewer_client.patch(f"/intercepts/{intercept['id']}", json={"name": "Nope"}).status_code == 403
    assert viewer_client.delete(f"/intercepts/{intercept['id']}").status_code == 403
    assert viewer_client.get(f"/intercepts/{intercept['id']}").status_code == 200


def test_intercept_notes_create_list_delete(editor_client, emitter_ctx):
    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])

    resp = editor_client.post(f"/intercepts/{intercept['id']}/notes", json={"body": "Looks like a new emitter type"})
    assert resp.status_code == 201, resp.text
    note = resp.json()
    assert note["body"] == "Looks like a new emitter type"

    resp = editor_client.get(f"/intercepts/{intercept['id']}/notes")
    assert resp.status_code == 200, resp.text
    assert len(resp.json()) == 1

    resp = editor_client.delete(f"/intercepts/{intercept['id']}/notes/{note['id']}")
    assert resp.status_code == 204, resp.text
    assert editor_client.get(f"/intercepts/{intercept['id']}/notes").json() == []


def test_fixed_entry_requires_jitter_mean(editor_client, emitter_ctx):
    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])
    entry = {k: v for k, v in FIXED_ENTRY.items() if k != "jitter_mean_us"}
    resp = editor_client.post(f"/intercepts/{intercept['id']}/entries", json=entry)
    assert resp.status_code == 422


def test_fixed_entry_rejects_stagger_values(editor_client, emitter_ctx):
    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])
    entry = {**FIXED_ENTRY, "stagger_values": [800, 850]}
    resp = editor_client.post(f"/intercepts/{intercept['id']}/entries", json=entry)
    assert resp.status_code == 422


def test_stagger_entry_requires_stagger_values(editor_client, emitter_ctx):
    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])
    entry = {k: v for k, v in STAGGER_ENTRY.items() if k != "stagger_values"}
    resp = editor_client.post(f"/intercepts/{intercept['id']}/entries", json=entry)
    assert resp.status_code == 422


def test_stagger_entry_rejects_jitter_mean(editor_client, emitter_ctx):
    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])
    entry = {**STAGGER_ENTRY, "jitter_mean_us": 10}
    resp = editor_client.post(f"/intercepts/{intercept['id']}/entries", json=entry)
    assert resp.status_code == 422


@pytest.mark.parametrize("missing_field", ["rf_mean_mhz", "pw_mean_us", "pri_mean_us"])
def test_entry_requires_every_mean(editor_client, emitter_ctx, missing_field):
    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])
    entry = {k: v for k, v in FIXED_ENTRY.items() if k != missing_field}
    resp = editor_client.post(f"/intercepts/{intercept['id']}/entries", json=entry)
    assert resp.status_code == 422


def test_valid_fixed_and_stagger_entries_succeed(editor_client, emitter_ctx):
    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])

    resp = editor_client.post(f"/intercepts/{intercept['id']}/entries", json=FIXED_ENTRY)
    assert resp.status_code == 201, resp.text
    assert resp.json()["jitter_mean_us"] == 10
    assert resp.json()["derived_mode_ids"] == []

    resp = editor_client.post(f"/intercepts/{intercept['id']}/entries", json=STAGGER_ENTRY)
    assert resp.status_code == 201, resp.text
    assert resp.json()["stagger_values"] == [800, 850, 900, 780]

    # min/max are optional and may be supplied alongside the required means
    with_bounds = {**FIXED_ENTRY, "rf_min_mhz": 2950, "rf_max_mhz": 3050}
    resp = editor_client.post(f"/intercepts/{intercept['id']}/entries", json=with_bounds)
    assert resp.status_code == 201, resp.text

    intercept = editor_client.get(f"/intercepts/{intercept['id']}").json()
    assert intercept["entry_count"] == 3


def test_entry_delete_cascades_link_without_deleting_mode(editor_client, emitter_ctx):
    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])
    entry = editor_client.post(f"/intercepts/{intercept['id']}/entries", json=FIXED_ENTRY).json()

    mode = editor_client.post(
        f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes",
        json={
            "source_id": emitter_ctx["source"]["id"],
            "name": "From Intercept",
            "pri_type": "fixed",
            "line": MODE_LINE,
            "derived_from_intercept_entry_ids": [entry["id"]],
        },
    ).json()
    modes = editor_client.get(f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes").json()
    before = next(m for m in modes if m["id"] == mode["id"])
    assert [e["id"] for e in before["derived_from_intercepts"]] == [entry["id"]]

    resp = editor_client.delete(f"/intercepts/{intercept['id']}/entries/{entry['id']}")
    assert resp.status_code == 204, resp.text

    resp = editor_client.get(f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes")
    assert resp.status_code == 200, resp.text
    refetched = next(m for m in resp.json() if m["id"] == mode["id"])
    assert refetched is not None
    assert refetched["derived_from_intercepts"] == []


def test_derived_mode_linkage_round_trip_both_directions(editor_client, emitter_ctx):
    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])
    entry = editor_client.post(f"/intercepts/{intercept['id']}/entries", json=FIXED_ENTRY).json()

    mode = editor_client.post(
        f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes",
        json={
            "source_id": emitter_ctx["source"]["id"],
            "name": "From Intercept",
            "pri_type": "fixed",
            "line": MODE_LINE,
            "derived_from_intercept_entry_ids": [entry["id"]],
        },
    ).json()

    modes = editor_client.get(f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes").json()
    refetched_mode = next(m for m in modes if m["id"] == mode["id"])
    assert [e["id"] for e in refetched_mode["derived_from_intercepts"]] == [entry["id"]]

    entries = editor_client.get(f"/intercepts/{intercept['id']}/entries").json()
    refetched_entry = next(e for e in entries if e["id"] == entry["id"])
    assert refetched_entry["derived_mode_ids"] == [mode["id"]]


def test_global_list_filtering_by_emitter_and_search(editor_client, emitter_ctx):
    other_emitter = editor_client.post("/emitters", json={"name": "Other Intercept Emitter"}).json()
    _create_intercept(editor_client, emitter_ctx["emitter"]["id"], name="Alpha Sighting")
    _create_intercept(editor_client, other_emitter["id"], name="Beta Sighting")

    resp = editor_client.get("/intercepts", params={"emitter_id": emitter_ctx["emitter"]["id"]})
    assert resp.status_code == 200, resp.text
    names = {i["name"] for i in resp.json()}
    assert names == {"Alpha Sighting"}

    resp = editor_client.get("/intercepts", params={"search": "beta"})
    assert resp.status_code == 200, resp.text
    names = {i["name"] for i in resp.json()}
    assert names == {"Beta Sighting"}


def test_404_on_mismatched_parent_ids(editor_client, emitter_ctx):
    intercept_a = _create_intercept(editor_client, emitter_ctx["emitter"]["id"], name="A")
    intercept_b = _create_intercept(editor_client, emitter_ctx["emitter"]["id"], name="B")
    entry = editor_client.post(f"/intercepts/{intercept_a['id']}/entries", json=FIXED_ENTRY).json()
    note = editor_client.post(f"/intercepts/{intercept_a['id']}/notes", json={"body": "hi"}).json()

    assert editor_client.delete(f"/intercepts/{intercept_b['id']}/entries/{entry['id']}").status_code == 404
    assert editor_client.delete(f"/intercepts/{intercept_b['id']}/notes/{note['id']}").status_code == 404


def test_bulk_create_entries_all_or_nothing(editor_client, emitter_ctx):
    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])

    resp = editor_client.post(
        f"/intercepts/{intercept['id']}/entries/bulk", json=[FIXED_ENTRY, STAGGER_ENTRY]
    )
    assert resp.status_code == 201, resp.text
    assert len(resp.json()) == 2
    assert editor_client.get(f"/intercepts/{intercept['id']}").json()["entry_count"] == 2

    invalid_row = {k: v for k, v in FIXED_ENTRY.items() if k != "jitter_mean_us"}
    resp = editor_client.post(
        f"/intercepts/{intercept['id']}/entries/bulk", json=[FIXED_ENTRY, invalid_row]
    )
    assert resp.status_code == 422
    # Nothing from the rejected batch was persisted
    assert editor_client.get(f"/intercepts/{intercept['id']}").json()["entry_count"] == 2


def test_deleting_an_intercept_writes_a_snapshot_of_what_was_deleted(editor_client, emitter_ctx):
    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"], name="Snapshot Intercept")
    resp = editor_client.delete(f"/intercepts/{intercept['id']}")
    assert resp.status_code == 204, resp.text

    log = editor_client.get(
        "/audit-log", params={"entity_type": "intercept", "entity_id": intercept["id"], "action": "delete"}
    ).json()
    assert log["total"] == 1, log
    assert log["items"][0]["changes"]["name"] == "Snapshot Intercept"
