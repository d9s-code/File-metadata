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


def test_intercept_recording_date_and_collector_round_trip(editor_client, emitter_ctx):
    emitter_id = emitter_ctx["emitter"]["id"]
    older = editor_client.post(
        "/intercepts",
        json={"emitter_id": emitter_id, "name": "Older", "intercepted_on": "2026-03-01", "collected_by": "P-8A ESM"},
    )
    assert older.status_code == 201, older.text
    assert older.json()["intercepted_on"] == "2026-03-01"
    assert older.json()["collected_by"] == "P-8A ESM"
    editor_client.post("/intercepts", json={"emitter_id": emitter_id, "name": "Undated"})
    newer = editor_client.post(
        "/intercepts", json={"emitter_id": emitter_id, "name": "Newer", "intercepted_on": "2026-08-14"}
    ).json()

    # Newest recording first, undated last.
    names = [i["name"] for i in editor_client.get("/intercepts", params={"emitter_id": emitter_id}).json()]
    assert names == ["Newer", "Older", "Undated"]

    resp = editor_client.patch(f"/intercepts/{newer['id']}", json={"intercepted_on": None, "collected_by": "Ground site"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["intercepted_on"] is None
    assert resp.json()["collected_by"] == "Ground site"


def test_replace_entry_keeps_id_and_derived_mode_link(editor_client, emitter_ctx):
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

    # Switching fixed -> stagger replaces the whole entry: jitter goes away.
    resp = editor_client.put(f"/intercepts/{intercept['id']}/entries/{entry['id']}", json=STAGGER_ENTRY)
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["id"] == entry["id"]
    assert updated["pri_type"] == "stagger"
    assert updated["jitter_mean_us"] is None
    assert updated["stagger_values"] == [800, 850, 900, 780]
    assert updated["derived_mode_ids"] == [mode["id"]]

    audit = editor_client.get("/audit-log", params={"entity_id": entry["id"], "action": "update"})
    assert audit.status_code == 200, audit.text
    [change] = audit.json()["items"]
    assert change["changes"]["pri_type"] == {"old": "fixed", "new": "stagger"}


def test_replace_entry_validates_and_checks_parent(viewer_client, editor_client, emitter_ctx):
    intercept_a = _create_intercept(editor_client, emitter_ctx["emitter"]["id"], name="A")
    intercept_b = _create_intercept(editor_client, emitter_ctx["emitter"]["id"], name="B")
    entry = editor_client.post(f"/intercepts/{intercept_a['id']}/entries", json=FIXED_ENTRY).json()

    no_jitter = {k: v for k, v in FIXED_ENTRY.items() if k != "jitter_mean_us"}
    assert editor_client.put(f"/intercepts/{intercept_a['id']}/entries/{entry['id']}", json=no_jitter).status_code == 422
    assert editor_client.put(f"/intercepts/{intercept_b['id']}/entries/{entry['id']}", json=FIXED_ENTRY).status_code == 404
    assert viewer_client.put(f"/intercepts/{intercept_a['id']}/entries/{entry['id']}", json=FIXED_ENTRY).status_code == 403


def test_list_every_entry_on_an_emitter(editor_client, emitter_ctx):
    emitter_id = emitter_ctx["emitter"]["id"]
    other_emitter = editor_client.post("/emitters", json={"name": "Other Entries Emitter"}).json()
    a = _create_intercept(editor_client, emitter_id, name="A")
    b = _create_intercept(editor_client, emitter_id, name="B")
    elsewhere = _create_intercept(editor_client, other_emitter["id"], name="Elsewhere")
    editor_client.post(f"/intercepts/{a['id']}/entries", json=FIXED_ENTRY)
    editor_client.post(f"/intercepts/{b['id']}/entries", json=STAGGER_ENTRY)
    editor_client.post(f"/intercepts/{elsewhere['id']}/entries", json=FIXED_ENTRY)

    resp = editor_client.get("/intercepts/entries", params={"emitter_id": emitter_id})
    assert resp.status_code == 200, resp.text
    assert sorted(e["intercept_id"] for e in resp.json()) == sorted([a["id"], b["id"]])


CW_ENTRY = {"pri_type": "cw", "rf_mean_mhz": 8080.118, "rf_min_mhz": 8080.1, "rf_max_mhz": 8080.2}


def test_cw_entry_takes_rf_only(editor_client, emitter_ctx):
    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])
    resp = editor_client.post(f"/intercepts/{intercept['id']}/entries", json=CW_ENTRY)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["pri_type"] == "cw"
    assert body["pri_mean_us"] is None and body["pw_mean_us"] is None

    for extra in ({"pw_mean_us": 1.0}, {"pri_mean_us": 1000}, {"jitter_mean_us": 0}, {"stagger_values": [1, 2]}):
        resp = editor_client.post(f"/intercepts/{intercept['id']}/entries", json={**CW_ENTRY, **extra})
        assert resp.status_code == 422, (extra, resp.text)


def test_xlet_entries_are_rejected(editor_client, emitter_ctx):
    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])
    resp = editor_client.post(
        f"/intercepts/{intercept['id']}/entries", json={"pri_type": "xlet", "rf_mean_mhz": 9500}
    )
    assert resp.status_code == 422


def test_import_creates_intercept_and_entries_together(editor_client, emitter_ctx):
    emitter_id = emitter_ctx["emitter"]["id"]
    resp = editor_client.post(
        "/intercepts/import",
        json={
            "intercept": {"emitter_id": emitter_id, "name": "OPR 103", "intercepted_on": "2025-12-01"},
            "entries": [FIXED_ENTRY, STAGGER_ENTRY, CW_ENTRY],
        },
    )
    assert resp.status_code == 201, resp.text
    intercept = resp.json()
    assert intercept["entry_count"] == 3
    assert intercept["intercepted_on"] == "2025-12-01"
    types = sorted(e["pri_type"] for e in editor_client.get(f"/intercepts/{intercept['id']}/entries").json())
    assert types == ["cw", "fixed", "stagger"]


def test_import_with_a_bad_entry_creates_nothing(editor_client, emitter_ctx):
    emitter_id = emitter_ctx["emitter"]["id"]
    bad = {k: v for k, v in FIXED_ENTRY.items() if k != "jitter_mean_us"}
    resp = editor_client.post(
        "/intercepts/import",
        json={"intercept": {"emitter_id": emitter_id, "name": "Half"}, "entries": [FIXED_ENTRY, bad]},
    )
    assert resp.status_code == 422
    resp = editor_client.post(
        "/intercepts/import", json={"intercept": {"emitter_id": emitter_id, "name": "Empty"}, "entries": []}
    )
    assert resp.status_code == 422
    names = {i["name"] for i in editor_client.get("/intercepts", params={"emitter_id": emitter_id}).json()}
    assert not names & {"Half", "Empty"}


def test_viewer_cannot_import(viewer_client, emitter_ctx):
    resp = viewer_client.post(
        "/intercepts/import",
        json={"intercept": {"emitter_id": emitter_ctx["emitter"]["id"], "name": "X"}, "entries": [FIXED_ENTRY]},
    )
    assert resp.status_code == 403


def test_import_caps_entries_per_request(editor_client, emitter_ctx):
    from app.schemas import intercept as intercept_schema

    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])
    too_many = [CW_ENTRY] * (intercept_schema.MAX_IMPORT_ENTRIES + 1)
    resp = editor_client.post(f"/intercepts/{intercept['id']}/entries/bulk", json=too_many)
    assert resp.status_code == 422
    resp = editor_client.post(
        "/intercepts/import",
        json={"intercept": {"emitter_id": emitter_ctx["emitter"]["id"], "name": "Big"}, "entries": too_many},
    )
    assert resp.status_code == 422


IMPORTED = {
    **FIXED_ENTRY,
    "first_seen_at": "2025-12-01T08:00:00Z",
    "last_seen_at": "2025-12-01T08:40:00Z",
    "report_count": 30,
    "tracks": ["11", "12"],
    "source_file": "OPR_103_EmitterTrackParameters.csv",
}


def test_imported_entry_keeps_where_it_came_from(editor_client, emitter_ctx):
    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])
    entry = editor_client.post(f"/intercepts/{intercept['id']}/entries", json=IMPORTED).json()
    assert entry["report_count"] == 30
    assert entry["tracks"] == ["11", "12"]
    assert entry["first_seen_at"].startswith("2025-12-01T08:00:00")

    # Correcting the values by hand doesn't wipe the provenance...
    resp = editor_client.put(
        f"/intercepts/{intercept['id']}/entries/{entry['id']}", json={**FIXED_ENTRY, "rf_mean_mhz": 3001}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["rf_mean_mhz"] == 3001
    assert resp.json()["report_count"] == 30
    assert resp.json()["source_file"] == "OPR_103_EmitterTrackParameters.csv"
    # ...unless the request sets it.
    resp = editor_client.put(
        f"/intercepts/{intercept['id']}/entries/{entry['id']}", json={**FIXED_ENTRY, "report_count": None}
    )
    assert resp.json()["report_count"] is None

    bad = {**IMPORTED, "first_seen_at": "2025-12-02T00:00:00Z"}
    assert editor_client.post(f"/intercepts/{intercept['id']}/entries", json=bad).status_code == 422


def test_import_writes_one_audit_row_for_its_entries(editor_client, admin_client, emitter_ctx):
    emitter_id = emitter_ctx["emitter"]["id"]
    resp = editor_client.post(
        "/intercepts/import",
        json={"intercept": {"emitter_id": emitter_id, "name": "OPR 104"}, "entries": [IMPORTED] * 40},
    )
    assert resp.status_code == 201, resp.text
    rows = admin_client.get("/audit-log", params={"entity_id": resp.json()["id"], "limit": 200}).json()["items"]
    assert len(rows) == 2
    added = next(r for r in rows if r["summary"].startswith("Added 40 entries"))
    assert added["changes"]["source_files"] == ["OPR_103_EmitterTrackParameters.csv"]
    entry_rows = admin_client.get("/audit-log", params={"entity_type": "intercept_entry", "emitter_id": emitter_id})
    assert entry_rows.json()["total"] == 0


def test_source_file_lookup_finds_earlier_imports(editor_client, emitter_ctx):
    emitter_id = emitter_ctx["emitter"]["id"]
    saved = editor_client.post(
        "/intercepts/import",
        json={"intercept": {"emitter_id": emitter_id, "name": "First import"}, "entries": [IMPORTED, IMPORTED]},
    ).json()
    found = editor_client.get("/intercepts/source-files", params={"name": IMPORTED["source_file"]}).json()
    assert [(f["intercept_id"], f["entry_count"]) for f in found] == [(saved["id"], 2)]
    assert editor_client.get("/intercepts/source-files", params={"name": "other.csv"}).json() == []


def test_bulk_delete_entries_all_or_nothing(editor_client, admin_client, emitter_ctx):
    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])
    other = _create_intercept(editor_client, emitter_ctx["emitter"]["id"], name="Other")
    ids = [editor_client.post(f"/intercepts/{intercept['id']}/entries", json=FIXED_ENTRY).json()["id"] for _ in range(3)]
    foreign = editor_client.post(f"/intercepts/{other['id']}/entries", json=FIXED_ENTRY).json()["id"]

    resp = editor_client.post(f"/intercepts/{intercept['id']}/entries/delete", json={"entry_ids": [ids[0], foreign]})
    assert resp.status_code == 404
    assert len(editor_client.get(f"/intercepts/{intercept['id']}/entries").json()) == 3

    resp = editor_client.post(f"/intercepts/{intercept['id']}/entries/delete", json={"entry_ids": ids[:2]})
    assert resp.status_code == 204, resp.text
    assert [e["id"] for e in editor_client.get(f"/intercepts/{intercept['id']}/entries").json()] == [ids[2]]
    row = admin_client.get("/audit-log", params={"entity_id": intercept["id"], "action": "delete"}).json()["items"][0]
    assert row["summary"].startswith("Deleted 2 entries")
    assert len(row["changes"]["entries"]) == 2


def test_merge_entries_weights_by_report_count_and_keeps_mode_links(editor_client, emitter_ctx):
    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])
    url = f"/intercepts/{intercept['id']}/entries"
    a = editor_client.post(
        url,
        json={**IMPORTED, "rf_mean_mhz": 3000, "rf_min_mhz": 2999, "rf_max_mhz": 3001, "report_count": 30},
    ).json()
    b = editor_client.post(
        url,
        json={
            **IMPORTED,
            "rf_mean_mhz": 3010,
            "report_count": 10,
            "tracks": ["13"],
            "first_seen_at": "2025-12-01T07:00:00Z",
            "last_seen_at": "2025-12-01T09:00:00Z",
        },
    ).json()
    mode = editor_client.post(
        f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes",
        json={
            "source_id": emitter_ctx["source"]["id"],
            "name": "From B",
            "pri_type": "fixed",
            "line": MODE_LINE,
            "derived_from_intercept_entry_ids": [b["id"]],
        },
    ).json()

    resp = editor_client.post(f"{url}/merge", json={"entry_ids": [b["id"], a["id"]]})
    assert resp.status_code == 200, resp.text
    merged = resp.json()
    assert merged["id"] == a["id"]  # the first created is kept
    assert merged["rf_mean_mhz"] == 3002.5  # (3000*30 + 3010*10) / 40
    assert (merged["rf_min_mhz"], merged["rf_max_mhz"]) == (2999, 3010)
    assert merged["report_count"] == 40
    assert merged["tracks"] == ["11", "12", "13"]
    assert merged["first_seen_at"].startswith("2025-12-01T07:00:00")
    assert merged["last_seen_at"].startswith("2025-12-01T09:00:00")
    assert merged["derived_mode_ids"] == [mode["id"]]
    assert merged["notes"].startswith("Merged from 2 entries.")
    assert [e["id"] for e in editor_client.get(url).json()] == [a["id"]]


def test_merge_refuses_mixed_pri_types(editor_client, emitter_ctx):
    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])
    url = f"/intercepts/{intercept['id']}/entries"
    a = editor_client.post(url, json=FIXED_ENTRY).json()
    b = editor_client.post(url, json=STAGGER_ENTRY).json()
    assert editor_client.post(f"{url}/merge", json={"entry_ids": [a["id"], b["id"]]}).status_code == 422
    assert editor_client.post(f"{url}/merge", json={"entry_ids": [a["id"]]}).status_code == 422
    assert len(editor_client.get(url).json()) == 2


def test_match_counts_per_intercept(editor_client, emitter_ctx):
    editor_client.post(
        f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes",
        json={"source_id": emitter_ctx["source"]["id"], "name": "M", "pri_type": "fixed", "line": MODE_LINE},
    )
    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])
    url = f"/intercepts/{intercept['id']}/entries"
    editor_client.post(url, json=FIXED_ENTRY)  # inside on RF, PRI and PW
    editor_client.post(url, json={**FIXED_ENTRY, "rf_mean_mhz": 3100.5})  # inside the engineered RF (± 1)
    editor_client.post(url, json={**FIXED_ENTRY, "rf_mean_mhz": 5000})  # outside on RF only: near
    editor_client.post(url, json={**FIXED_ENTRY, "rf_mean_mhz": 5000, "pw_mean_us": 9})  # two off: none
    editor_client.post(url, json=STAGGER_ENTRY)  # no stagger Mode: none

    counts = editor_client.get("/intercepts/match-counts", params={"emitter_id": emitter_ctx["emitter"]["id"]}).json()
    assert counts["total"] == {"match": 2, "near": 1, "none": 2}
    assert counts["by_intercept"][intercept["id"]] == {"match": 2, "near": 1, "none": 2}


def test_intercepts_of_a_deleted_emitter_are_read_only_and_hidden(editor_client, emitter_ctx):
    emitter_id = emitter_ctx["emitter"]["id"]
    intercept = _create_intercept(editor_client, emitter_id)
    entry = editor_client.post(f"/intercepts/{intercept['id']}/entries", json=FIXED_ENTRY).json()
    assert editor_client.delete(f"/emitters/{emitter_id}").status_code == 204

    assert editor_client.post("/intercepts", json={"emitter_id": emitter_id, "name": "Late"}).status_code == 404
    assert editor_client.post(f"/intercepts/{intercept['id']}/entries", json=FIXED_ENTRY).status_code == 404
    assert editor_client.delete(f"/intercepts/{intercept['id']}/entries/{entry['id']}").status_code == 404
    assert editor_client.patch(f"/intercepts/{intercept['id']}", json={"name": "X"}).status_code == 404
    assert all(i["id"] != intercept["id"] for i in editor_client.get("/intercepts").json())
