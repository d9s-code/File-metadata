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


def test_merge_range_spans_the_means_when_entries_have_no_measured_range(editor_client, emitter_ctx):
    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])
    url = f"/intercepts/{intercept['id']}/entries"
    a = editor_client.post(url, json={**FIXED_ENTRY, "pri_mean_us": 800, "pw_mean_us": 1.0, "report_count": 3}).json()
    b = editor_client.post(url, json={**FIXED_ENTRY, "pri_mean_us": 1200, "pw_mean_us": 2.0, "report_count": 1}).json()
    merged = editor_client.post(f"{url}/merge", json={"entry_ids": [a["id"], b["id"]]}).json()
    assert merged["pri_mean_us"] == 900  # (800*3 + 1200) / 4
    assert (merged["pri_min_us"], merged["pri_max_us"]) == (800, 1200)
    assert (merged["pw_min_us"], merged["pw_max_us"]) == (1.0, 2.0)


def _report(line, entry, rf=3000.0, time="2025-12-01T08:00:00Z", track="11", pri_type="fixed"):
    pri = None if pri_type == "cw" else 1000.0
    pw = None if pri_type == "cw" else 1.0
    jitter = 0.01 if pri_type == "fixed" else None
    return [line, time, track, "1", -40.5, "U000A", "Default", 1, pri_type, rf, pri, pw, jitter, None, entry]


def _import_with_reports(editor_client, emitter_id, groups, left_out=0, name="With reports"):
    """groups: report counts per entry. Returns (intercept, entries sorted by RF)."""
    entries, rows, line = [], [], 1
    for i, n in enumerate(groups):
        entries.append({**FIXED_ENTRY, "rf_mean_mhz": 3000 + 10 * i, "report_count": n, "source_file": "f.csv"})
        for _ in range(n):
            rows.append(_report(line, i, rf=3000 + 10 * i))
            line += 1
    for _ in range(left_out):
        rows.append(_report(line, None, rf=4000))
        line += 1
    resp = editor_client.post(
        "/intercepts/import",
        json={
            "intercept": {"emitter_id": emitter_id, "name": name},
            "entries": entries,
            "reports": {"source_file": "f.csv", "rows": rows},
        },
    )
    assert resp.status_code == 201, resp.text
    intercept = resp.json()
    saved = sorted(editor_client.get(f"/intercepts/{intercept['id']}/entries").json(), key=lambda e: e["rf_mean_mhz"])
    return intercept, saved


def test_import_keeps_reports_linked_to_their_entries(editor_client, emitter_ctx):
    intercept, entries = _import_with_reports(editor_client, emitter_ctx["emitter"]["id"], [3, 2], left_out=4)
    assert intercept["report_count"] == 9
    assert intercept["grouping_version"] == 1
    url = f"/intercepts/{intercept['id']}/reports"
    page = editor_client.get(url, params={"limit": 5}).json()
    assert page["total"] == 9 and len(page["items"]) == 5
    assert page["items"][0]["file_line"] == 1 and page["items"][0]["source_file"] == "f.csv"
    first = editor_client.get(url, params={"entry_id": entries[0]["id"]}).json()
    assert first["total"] == 3 and {r["entry_id"] for r in first["items"]} == {entries[0]["id"]}
    left = editor_client.get(url, params={"entry_id": "none"}).json()
    assert left["total"] == 4
    by_rf = editor_client.get(url, params={"sort": "rf", "direction": "desc", "limit": 1}).json()
    assert by_rf["items"][0]["rf_mhz"] == 4000


def test_import_refuses_a_report_pointing_at_no_entry(editor_client, emitter_ctx):
    resp = editor_client.post(
        "/intercepts/import",
        json={
            "intercept": {"emitter_id": emitter_ctx["emitter"]["id"], "name": "Bad"},
            "entries": [FIXED_ENTRY],
            "reports": {"rows": [_report(1, 3)]},
        },
    )
    assert resp.status_code == 422


def test_import_into_an_existing_intercept_adds_reports(editor_client, emitter_ctx):
    intercept, _ = _import_with_reports(editor_client, emitter_ctx["emitter"]["id"], [2])
    resp = editor_client.post(
        f"/intercepts/{intercept['id']}/import",
        json={"entries": [FIXED_ENTRY], "reports": {"source_file": "g.csv", "rows": [_report(1, 0), _report(2, None)]}},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["report_count"] == 4
    assert resp.json()["entry_count"] == 2


def test_all_reports_come_compactly_with_their_entry(editor_client, emitter_ctx):
    intercept, entries = _import_with_reports(editor_client, emitter_ctx["emitter"]["id"], [2, 1], left_out=1)
    body = editor_client.get(f"/intercepts/{intercept['id']}/reports/all").json()
    assert body["grouping_version"] == 1
    assert body["fields"][:3] == ["source_file", "file_line", "mission_time"]
    assert len(body["reports"]) == 4
    entry_of = [body["entries"][r[1]] if r[1] is not None else None for r in body["reports"]]
    assert entry_of == [entries[0]["id"], entries[0]["id"], entries[1]["id"], None]
    first = body["reports"][0]
    assert first[2] == "f.csv" and first[3] == 1 and first[11] == "fixed" and first[12] == 3000.0


def _regroup(editor_client, intercept_id, groups, version, dry_run=False):
    return editor_client.put(
        f"/intercepts/{intercept_id}/grouping",
        params={"dry_run": str(dry_run).lower()},
        json={
            "expected_version": version,
            "groups": [{"entry": {**FIXED_ENTRY, "rf_mean_mhz": rf}, "report_ids": ids} for rf, ids in groups],
        },
    )


def test_regroup_keeps_entry_ids_and_moves_mode_links(editor_client, emitter_ctx):
    # B has more reports than C, so the merged group keeps B's id and C is removed.
    intercept, entries = _import_with_reports(editor_client, emitter_ctx["emitter"]["id"], [3, 3, 2], left_out=1)
    iid = intercept["id"]
    mode = editor_client.post(
        f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes",
        json={
            "source_id": emitter_ctx["source"]["id"],
            "name": "From C",
            "pri_type": "fixed",
            "line": MODE_LINE,
            "derived_from_intercept_entry_ids": [entries[2]["id"]],
        },
    ).json()
    body = editor_client.get(f"/intercepts/{iid}/reports/all").json()
    ids_of = {}
    for r in body["reports"]:
        key = body["entries"][r[1]] if r[1] is not None else None
        ids_of.setdefault(key, []).append(r[0])
    a, b, c = (ids_of[e["id"]] for e in entries)
    stray = ids_of[None]
    # A stays as it is; B and C become one group (with C's Mode link following); the stray joins A's neighbour.
    groups = [(3000, a), (3015, b + c), (4000, stray)]

    dry = _regroup(editor_client, iid, groups, 1, dry_run=True)
    assert dry.status_code == 200, dry.text
    assert dry.json() == {
        "unchanged": 1, "changed": 1, "created": 1, "removed": 1,
        "mode_links_moved": 1, "mode_links_dropped": 0, "reports_left_out": 0, "grouping_version": 1,
    }
    assert len(editor_client.get(f"/intercepts/{iid}/entries").json()) == 3  # the dry run changed nothing

    resp = _regroup(editor_client, iid, groups, 1)
    assert resp.status_code == 200, resp.text
    assert resp.json()["grouping_version"] == 2
    after = {e["rf_mean_mhz"]: e for e in editor_client.get(f"/intercepts/{iid}/entries").json()}
    assert after[3000]["id"] == entries[0]["id"]
    assert after[3015]["id"] == entries[1]["id"]
    assert after[3015]["derived_mode_ids"] == [mode["id"]]
    assert editor_client.get(f"/intercepts/{iid}/reports", params={"entry_id": "none"}).json()["total"] == 0
    assert editor_client.get(f"/intercepts/{iid}/reports", params={"entry_id": after[3015]["id"]}).json()["total"] == 5

    # Saved against the old version: refused.
    assert _regroup(editor_client, iid, groups, 1).status_code == 409


def test_regroup_validates_reports_and_leaves_hand_typed_entries(editor_client, emitter_ctx):
    intercept, entries = _import_with_reports(editor_client, emitter_ctx["emitter"]["id"], [2])
    iid = intercept["id"]
    typed = editor_client.post(f"/intercepts/{iid}/entries", json=STAGGER_ENTRY).json()
    ids = [r[0] for r in editor_client.get(f"/intercepts/{iid}/reports/all").json()["reports"]]
    assert _regroup(editor_client, iid, [(3000, ids), (3001, ids[:1])], 1).status_code == 422
    other, _ = _import_with_reports(editor_client, emitter_ctx["emitter"]["id"], [1], name="Other")
    foreign = editor_client.get(f"/intercepts/{other['id']}/reports/all").json()["reports"][0][0]
    assert _regroup(editor_client, iid, [(3000, [foreign])], 1).status_code == 422
    # Everything left out: the imported entry goes, the typed one stays.
    resp = _regroup(editor_client, iid, [], 1)
    assert resp.status_code == 200, resp.text
    assert resp.json()["removed"] == 1 and resp.json()["reports_left_out"] == 2
    assert [e["id"] for e in editor_client.get(f"/intercepts/{iid}/entries").json()] == [typed["id"]]


def test_merge_and_delete_keep_reports(editor_client, emitter_ctx):
    intercept, entries = _import_with_reports(editor_client, emitter_ctx["emitter"]["id"], [2, 3, 1])
    iid = intercept["id"]
    merged = editor_client.post(
        f"/intercepts/{iid}/entries/merge", json={"entry_ids": [entries[0]["id"], entries[1]["id"]]}
    ).json()
    assert editor_client.get(f"/intercepts/{iid}/reports", params={"entry_id": merged["id"]}).json()["total"] == 5
    editor_client.delete(f"/intercepts/{iid}/entries/{entries[2]['id']}")
    assert editor_client.get(f"/intercepts/{iid}/reports", params={"entry_id": "none"}).json()["total"] == 1
    assert editor_client.get(f"/intercepts/{iid}").json()["grouping_version"] == 3


def _modes_from(editor_client, ctx, intercept_id, entry_ids, **options):
    return editor_client.post(
        f"/ew-groups/{ctx['ew_group']['id']}/modes/from-intercept",
        json={
            "intercept_id": intercept_id,
            "entry_ids": entry_ids,
            "source_id": ctx["source"]["id"],
            "name_prefix": "Pass A",
            "rf_delta": 1,
            "pw_delta": 0.05,
            "pri_delta": 10,
            "frame_time_delta_us": 5,
            **options,
        },
    )


def test_create_modes_from_intercept_entries(editor_client, emitter_ctx):
    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])
    url = f"/intercepts/{intercept['id']}/entries"
    fixed = editor_client.post(
        url, json={**FIXED_ENTRY, "rf_min_mhz": 2990, "rf_max_mhz": 3010, "pri_min_us": 990, "pri_max_us": 1010}
    ).json()
    stagger = editor_client.post(
        url, json={**STAGGER_ENTRY, "rf_mean_mhz": 3100, "pri_mean_us": 3335, "pri_min_us": 3331, "pri_max_us": 3343}
    ).json()
    cw = editor_client.post(url, json={**CW_ENTRY, "rf_mean_mhz": 3200}).json()
    ids = [fixed["id"], stagger["id"], cw["id"]]

    # A CW entry needs a PW range given for its Mode — and nothing is created without one.
    assert _modes_from(editor_client, emitter_ctx, intercept["id"], ids).status_code == 422
    assert editor_client.get(f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes").json() == []

    resp = _modes_from(editor_client, emitter_ctx, intercept["id"], ids, cw_pw_min_us=0.5, cw_pw_max_us=1.5)
    assert resp.status_code == 201, resp.text
    modes = resp.json()
    assert [m["name"] for m in modes] == ["Pass A 1", "Pass A 2", "Pass A 3"]
    assert len({m["generation_batch_id"] for m in modes}) == 1
    by_type = {m["pri_type"]: m for m in modes}
    f_line = by_type["fixed"]["line"]
    assert (f_line["rf_min_mhz"], f_line["rf_max_mhz"], f_line["rf_delta"]) == (2990, 3010, 1)
    assert (f_line["pri_min_us"], f_line["pri_max_us"], f_line["pri_delta"]) == (990, 1010, 10)
    assert f_line["jitter_min_us"] == f_line["jitter_max_us"] == 10
    s_line = by_type["stagger"]["line"]
    assert s_line["pri_stagger_values_us"] == [800, 850, 900, 780]
    assert s_line["explicit_frame_time_us"] == 3335  # the entry's frame time, not the sum (3330)
    # The measured frame-time spread (3331–3343, 8 above the mean) goes into the delta, on top of the 5 asked for,
    # so the Mode reaches every frame time measured.
    assert s_line["frame_time_delta_us"] == 13
    assert (s_line["engineered_frame_time_min_us"], s_line["engineered_frame_time_max_us"]) == (3322, 3348)
    c_line = by_type["cw"]["line"]
    assert (c_line["pw_min_us"], c_line["pw_max_us"]) == (0.5, 1.5)
    entries = {e["id"]: e for e in editor_client.get(url).json()}
    assert entries[fixed["id"]]["derived_mode_ids"] == [by_type["fixed"]["id"]]

    # Again with the same prefix: names carry on rather than clash; "mean" gives a point range.
    again = _modes_from(editor_client, emitter_ctx, intercept["id"], [fixed["id"], stagger["id"]], ranges="mean").json()
    assert again[0]["name"] == "Pass A 4"
    assert (again[0]["line"]["rf_min_mhz"], again[0]["line"]["rf_max_mhz"]) == (3000, 3000)
    assert again[1]["line"]["frame_time_delta_us"] == 5  # "mean": no spread added


def test_modes_from_intercept_check_entries_and_emitter(editor_client, viewer_client, emitter_ctx):
    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])
    other = _create_intercept(editor_client, emitter_ctx["emitter"]["id"], name="Other")
    foreign = editor_client.post(f"/intercepts/{other['id']}/entries", json=FIXED_ENTRY).json()
    resp = _modes_from(editor_client, emitter_ctx, intercept["id"], [foreign["id"]])
    assert resp.status_code == 404
    entry = editor_client.post(f"/intercepts/{intercept['id']}/entries", json=FIXED_ENTRY).json()
    resp = viewer_client.post(
        f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes/from-intercept",
        json={"intercept_id": intercept["id"], "entry_ids": [entry["id"]], "source_id": emitter_ctx["source"]["id"], "name_prefix": "X"},
    )
    assert resp.status_code == 403


def _plan(editor_client, ctx, intercept_id, **plan):
    return editor_client.post(
        f"/ew-groups/{ctx['ew_group']['id']}/modes/from-intercept-plan",
        json={"intercept_id": intercept_id, **plan},
    )


def test_intercept_mode_plan_creates_and_widens(editor_client, emitter_ctx):
    ew = emitter_ctx["ew_group"]["id"]
    existing = editor_client.post(
        f"/ew-groups/{ew}/modes",
        json={"source_id": emitter_ctx["source"]["id"], "name": "Search 1", "pri_type": "fixed", "line": MODE_LINE},
    ).json()
    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])
    url = f"/intercepts/{intercept['id']}/entries"
    # Inside "Search 1" on RF and PRI, outside on PW (2.0 against 0.5–1.2): a partial match.
    partial = editor_client.post(url, json={**FIXED_ENTRY, "pw_mean_us": 2.0, "pw_min_us": 1.9, "pw_max_us": 2.1}).json()
    unmatched = editor_client.post(url, json={**FIXED_ENTRY, "rf_mean_mhz": 5000}).json()
    new_line = {**MODE_LINE, "rf_min_mhz": 4990, "rf_max_mhz": 5010}
    counts = editor_client.get("/intercepts/match-counts", params={"emitter_id": emitter_ctx["emitter"]["id"]}).json()
    assert counts["by_intercept"][intercept["id"]] == {"match": 0, "near": 2, "none": 0}

    resp = _plan(
        editor_client,
        emitter_ctx,
        intercept["id"],
        source_id=emitter_ctx["source"]["id"],
        name_prefix="Pass B",
        confirmation_quality=60,
        confirmation_quantity=1,
        new_modes=[{"entry_ids": [unmatched["id"]], "pri_type": "fixed", "line": new_line}],
        widen=[{"mode_id": existing["id"], "entry_ids": [partial["id"]], "pw_max_us": 2.1}],
    )
    assert resp.status_code == 201, resp.text
    result = resp.json()
    [created] = result["created"]
    assert created["name"] == "Pass B 1"
    assert (created["line"]["rf_min_mhz"], created["line"]["rf_max_mhz"]) == (4990, 5010)
    assert (created["confirmation_quality"], created["confirmation_quantity"]) == (60, 1)
    [widened] = result["widened"]
    assert widened["id"] == existing["id"]
    assert (widened["line"]["pw_min_us"], widened["line"]["pw_max_us"]) == (0.5, 2.1)
    # Nothing else about the Mode changed.
    assert (widened["line"]["rf_min_mhz"], widened["line"]["pri_max_us"], widened["line"]["pw_delta"]) == (2900, 1200, 0.05)
    assert widened["name"] == "Search 1" and widened["generation_batch_id"] is None
    assert widened["derived_from_intercepts"][0]["intercept_name"] == "Morning Pass"

    entries = {e["id"]: e for e in editor_client.get(url).json()}
    assert entries[partial["id"]]["derived_mode_ids"] == [existing["id"]]
    assert entries[unmatched["id"]]["derived_mode_ids"] == [created["id"]]
    # Before the plan both are partial matches (the second is off on RF). After: both match.
    counts = editor_client.get("/intercepts/match-counts", params={"emitter_id": emitter_ctx["emitter"]["id"]}).json()
    assert counts["by_intercept"][intercept["id"]] == {"match": 2, "near": 0, "none": 0}

    audit = editor_client.get("/audit-log", params={"entity_id": existing["id"], "action": "update"}).json()
    items = audit["items"] if isinstance(audit, dict) else audit
    assert any("Widened Mode 'Search 1' (PW)" in a["summary"] for a in items)


def test_intercept_mode_plan_is_all_or_nothing(editor_client, emitter_ctx):
    ew = emitter_ctx["ew_group"]["id"]
    existing = editor_client.post(
        f"/ew-groups/{ew}/modes",
        json={"source_id": emitter_ctx["source"]["id"], "name": "Search 1", "pri_type": "fixed", "line": MODE_LINE},
    ).json()
    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])
    entry = editor_client.post(f"/intercepts/{intercept['id']}/entries", json=FIXED_ENTRY).json()
    new = [{"entry_ids": [entry["id"]], "pri_type": "fixed", "line": MODE_LINE}]
    base = {"source_id": emitter_ctx["source"]["id"], "name_prefix": "P", "new_modes": new}

    # Narrowing is refused — and the new Mode in the same plan isn't created either.
    resp = _plan(editor_client, emitter_ctx, intercept["id"], **base, widen=[{"mode_id": existing["id"], "entry_ids": [entry["id"]], "pw_max_us": 1.0}])
    assert resp.status_code == 422 and "only grows" in resp.text
    assert [m["name"] for m in editor_client.get(f"/ew-groups/{ew}/modes").json()] == ["Search 1"]

    # A fixed Mode has no frame time; the same Mode can't be widened twice; an empty plan does nothing.
    assert _plan(editor_client, emitter_ctx, intercept["id"], widen=[{"mode_id": existing["id"], "entry_ids": [entry["id"]], "frame_time_delta_us": 5}]).status_code == 422
    twice = [{"mode_id": existing["id"], "entry_ids": [entry["id"]], "pw_max_us": 1.3}] * 2
    assert _plan(editor_client, emitter_ctx, intercept["id"], widen=twice).status_code == 422
    assert _plan(editor_client, emitter_ctx, intercept["id"]).status_code == 422
    # New Modes need a Source and a name prefix.
    assert _plan(editor_client, emitter_ctx, intercept["id"], new_modes=new).status_code == 422

    # A Mode on another Emitter can't be widened from here.
    other = editor_client.post("/emitters", json={"name": "Elsewhere"}).json()
    other_group = editor_client.post(
        f"/emitters/{other['id']}/ew-groups", json={"name": "G", "scan_min": 1.0, "scan_max": 2.0, "threat_priority": 5}
    ).json()
    other_source = editor_client.post(f"/emitters/{other['id']}/sources", json={"name": "S", "source_date": "2025-01-15"}).json()
    foreign = editor_client.post(
        f"/ew-groups/{other_group['id']}/modes",
        json={"source_id": other_source["id"], "name": "F", "pri_type": "fixed", "line": MODE_LINE},
    ).json()
    resp = _plan(editor_client, emitter_ctx, intercept["id"], widen=[{"mode_id": foreign["id"], "entry_ids": [entry["id"]], "pw_max_us": 1.3}])
    assert resp.status_code == 404

    # Widening a Mode that already covers the entry just links it.
    resp = _plan(editor_client, emitter_ctx, intercept["id"], widen=[{"mode_id": existing["id"], "entry_ids": [entry["id"]], "pw_max_us": 1.2}])
    assert resp.status_code == 201, resp.text
    resp = _plan(editor_client, emitter_ctx, intercept["id"], widen=[{"mode_id": existing["id"], "entry_ids": [entry["id"]]}])
    assert resp.status_code == 201, resp.text
    assert editor_client.get(f"/intercepts/{intercept['id']}/entries").json()[0]["derived_mode_ids"] == [existing["id"]]


def test_intercept_mode_plan_widens_a_stagger_on_frame_time(editor_client, emitter_ctx):
    ew = emitter_ctx["ew_group"]["id"]
    stagger_line = {
        "rf_min_mhz": 2900, "rf_max_mhz": 3100, "pw_min_us": 0.5, "pw_max_us": 1.2,
        "pri_stagger_values_us": [800, 850, 900, 780], "frame_time_delta_us": 2,
        "rf_delta": 0, "pw_delta": 0,
        "rf_range_matching": False, "pw_range_matching": False, "pri_range_matching": False,
    }
    mode = editor_client.post(
        f"/ew-groups/{ew}/modes",
        json={"source_id": emitter_ctx["source"]["id"], "name": "Stag", "pri_type": "stagger", "line": stagger_line},
    )
    assert mode.status_code == 201, mode.text
    mode = mode.json()
    intercept = _create_intercept(editor_client, emitter_ctx["emitter"]["id"])
    entry = editor_client.post(f"/intercepts/{intercept['id']}/entries", json={**STAGGER_ENTRY, "pri_mean_us": 3340}).json()
    bad = _plan(editor_client, emitter_ctx, intercept["id"], widen=[{"mode_id": mode["id"], "entry_ids": [entry["id"]], "pri_max_us": 4000}])
    assert bad.status_code == 422
    resp = _plan(editor_client, emitter_ctx, intercept["id"], widen=[{"mode_id": mode["id"], "entry_ids": [entry["id"]], "frame_time_delta_us": 10}])
    assert resp.status_code == 201, resp.text
    line = resp.json()["widened"][0]["line"]
    assert (line["engineered_frame_time_min_us"], line["engineered_frame_time_max_us"]) == (3320, 3340)
