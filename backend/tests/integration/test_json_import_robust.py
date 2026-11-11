"""The JSON import leaves out what it can't read — and says so — instead of
failing the whole file: a sequence with no RF, PRI or PW, a value that isn't
a number, a parametric set left empty. Everything else is imported as it
always was."""

import json

from app.services.json_import.transformer import transform_json_to_payload


def _file(*sets):
    return [{"file": "doc.xml", "notation": "N-1", "parametric_sets": list(sets)}]


def _set(set_id, *groups):
    return {"set_id": set_id, "date_last_updated": "10-06-2015 17:19:28 GMT", "groups": list(groups)}


def _seq(name, *steps):
    return {"type": "sequence", "name": name, "steps": list(steps)}


def _pri(n, v):
    return {"step-num": str(n), "pri-value": {"min": str(v), "max": str(v)}}


RF_ELEMENT = {"type": "independent", "kind": "rf", "values": [{"sub_kind": "rf-typical", "value": {"min": "9000", "max": "9100"}}]}


def _transform(data):
    skipped: list[str] = []
    payload = transform_json_to_payload(data, skipped=skipped)
    return payload, skipped


def test_a_sequence_without_rf_pri_or_pw_is_left_out():
    payload, skipped = _transform(_file(_set(
        "SET-1",
        _seq("Good", _pri(1, 800), _pri(2, 900)),
        # Only a scan and a dwell — nothing to build a Mode from.
        _seq("Scan only", {"step-num": "1", "scan-value": {"min": "2", "max": "4"}}),
        _seq("Empty"),
        RF_ELEMENT,
    )))
    [pset] = payload.parametric_sets
    assert [s.label for s in pset.sequences] == ["Good"]
    assert len(pset.elements) == 1
    assert skipped == [
        "Sequence 'Scan only' in 'SET-1': no step has an RF, PRI or PW — left out",
        "Sequence 'Empty' in 'SET-1': no step has an RF, PRI or PW — left out",
    ]


def test_a_step_value_that_isnt_a_number_is_dropped_from_its_step():
    payload, skipped = _transform(_file(_set(
        "SET-1",
        _seq("Mixed",
             {"step-num": "1", "pri-value": {"min": "800", "max": "800"}, "rf-value": {"min": "N/A", "max": "9100"}},
             {"step-num": "2", "pri-value": {"min": "", "max": ""}},
             _pri(3, 1000)),
    )))
    steps = [s.model_dump(exclude_none=True) for s in payload.parametric_sets[0].sequences[0].steps]
    # Step 1 keeps its PRI; step 2 had nothing readable; step 3 as it was.
    assert steps == [{"order": 1, "pri_us": 800}, {"order": 3, "pri_us": 1000}]
    assert skipped == []


def test_a_min_above_its_max_is_swapped():
    payload, _ = _transform(_file(_set(
        "SET-1",
        _seq("Backwards",
             {"step-num": "1", "pri-value": {"min": "820", "max": "800"}, "rf-value": {"min": "9100", "max": "9000"}}),
    )))
    [step] = payload.parametric_sets[0].sequences[0].steps
    assert (step.pri_min_us, step.pri_max_us, step.rf_min_mhz, step.rf_max_mhz) == (800, 820, 9000, 9100)


def test_an_element_that_cant_be_read_is_left_out():
    payload, skipped = _transform(_file(_set(
        "SET-1",
        {"type": "independent", "kind": "rf", "values": [
            {"sub_kind": "rf-typical", "value": {"min": "9000", "max": "9100"}},
            {"sub_kind": "rf-extreme", "value": {"min": "lots", "max": "9500"}},
        ]},
    )))
    [pset] = payload.parametric_sets
    assert [(e.value_min, e.value_max) for e in pset.elements] == [(9000, 9100)]
    assert len(skipped) == 1
    assert skipped[0].startswith("An RF element (rf-extreme) in 'SET-1': couldn't be read")


def test_a_set_left_with_nothing_is_left_out_and_the_rest_imported():
    payload, skipped = _transform(_file(
        _set("GOOD", _seq("Train", _pri(1, 800), _pri(2, 900))),
        _set("NOTHING", _seq("Empty")),
    ))
    assert [p.source_name for p in payload.parametric_sets] == ["GOOD"]
    assert "Parametric set 'NOTHING': nothing in it could be read — left out" in skipped


def test_a_clean_file_imports_exactly_as_before():
    data = _file(_set("SET-1", _seq("Train", _pri(1, 800), _pri(2, 900)), RF_ELEMENT))
    payload, skipped = _transform(data)
    assert skipped == []
    # The same as without asking for what was left out.
    assert payload == transform_json_to_payload(data)


def test_the_upload_says_what_was_left_out(editor_client):
    eid = editor_client.post("/emitters", json={"name": "Robust import"}).json()["id"]
    data = _file(_set("SET-1", _seq("Good", _pri(1, 800), _pri(2, 900)), _seq("Scan only", {"step-num": "1", "scan-value": {"min": "2", "max": "4"}})))
    resp = editor_client.post(
        f"/emitters/{eid}/imports/json-import",
        files={"file": ("f.json", json.dumps(data).encode(), "application/json")},
        data={"source_date": "2026-03-01"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["sequence_count"] == 1
    assert body["skipped"] == ["Sequence 'Scan only' in 'SET-1': no step has an RF, PRI or PW — left out"]
    audit = editor_client.get("/audit-log", params={"emitter_id": eid}).json()["items"]
    entry = next(a for a in audit if a["summary"].startswith("Imported 1 Source(s) from JSON"))
    assert entry["changes"]["left_out"] == body["skipped"]


def test_nothing_readable_at_all_is_still_refused_and_says_why(editor_client):
    eid = editor_client.post("/emitters", json={"name": "Robust import"}).json()["id"]
    resp = editor_client.post(
        f"/emitters/{eid}/imports/json-import",
        files={"file": ("f.json", json.dumps(_file(_set("ONLY", _seq("Empty")))).encode(), "application/json")},
        data={"source_date": "2026-03-01"},
    )
    assert resp.status_code == 422
    assert "Left out: Sequence 'Empty' in 'ONLY'" in resp.text


def _upload(client, eid, data, path="json-import"):
    return client.post(
        f"/emitters/{eid}/imports/{path}",
        files={"file": ("f.json", json.dumps(data).encode(), "application/json")},
        data={"source_date": "2026-03-01"},
    )


def test_preview_shows_what_would_be_imported_and_saves_nothing(editor_client):
    eid = editor_client.post("/emitters", json={"name": "Preview import"}).json()["id"]
    data = _file(
        _set("SET-1", _seq("Train", _pri(1, 800), _pri(2, 900)), _seq("Scan only", {"step-num": "1", "scan-value": {"min": "2", "max": "4"}}), RF_ELEMENT),
        _set("SET-2", _seq("Hops",
                           {"step-num": "1", "rf-value": {"min": "9000", "max": "9000"}, "pri-value": {"min": "800", "max": "800"}},
                           {"step-num": "2", "rf-value": {"min": "9200", "max": "9200"}, "pri-value": {"min": "900", "max": "900"}})),
    )
    resp = _upload(editor_client, eid, data, "json-import/preview")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["valid"] is True and body["document_name"] == "doc.xml"
    assert [s["source_name"] for s in body["sets"]] == ["SET-1", "SET-2"]
    first, second = body["sets"]
    assert first["source_date"] == "2026-03-01"
    assert [(e["element_type"], e["variant"], e["value_min"], e["value_max"]) for e in first["elements"]] == [("rf", "typical", 9000, 9100)]
    assert first["sequences"] == [{"label": "Train", "steps": 2, "parameters": ["PRI"], "guessed_kind": "stagger"}]
    assert second["sequences"][0]["parameters"] == ["RF", "PRI"]
    assert second["sequences"][0]["guessed_kind"] == "dwell_switch"
    assert body["skipped"] == ["Sequence 'Scan only' in 'SET-1': no step has an RF, PRI or PW — left out"]
    assert (body["element_count"], body["sequence_count"]) == (1, 2)
    # Each set says what of it is left out.
    assert first["left_out"] == body["skipped"] and second["left_out"] == []
    # Nothing was saved.
    assert editor_client.get(f"/emitters/{eid}/sources").json() == []


def test_preview_warns_about_a_source_name_already_there(editor_client):
    eid = editor_client.post("/emitters", json={"name": "Preview import"}).json()["id"]
    data = _file(_set("SET-1", _seq("Train", _pri(1, 800), _pri(2, 900))))
    assert _upload(editor_client, eid, data).status_code == 201
    body = _upload(editor_client, eid, data, "json-import/preview").json()
    assert body["valid"] is True  # a warning, not a block
    assert body["sets"][0]["name_taken"] is True
    assert [(i["severity"], i["message"]) for i in body["issues"]] == [
        ("warning", "A Source named 'SET-1' is already on this Emitter — the import adds another")
    ]


def test_preview_blocks_duplicate_names_within_the_file(editor_client):
    eid = editor_client.post("/emitters", json={"name": "Preview import"}).json()["id"]
    data = _file(_set("SAME", _seq("A", _pri(1, 800))), _set("SAME", _seq("B", _pri(1, 900))))
    body = _upload(editor_client, eid, data, "json-import/preview").json()
    assert body["valid"] is False
    assert any(i["severity"] == "error" and "Duplicate source_name 'SAME'" in i["message"] for i in body["issues"])


def test_preview_of_an_unreadable_file_says_why(editor_client):
    eid = editor_client.post("/emitters", json={"name": "Preview import"}).json()["id"]
    resp = editor_client.post(
        f"/emitters/{eid}/imports/json-import/preview",
        files={"file": ("f.json", b"{not json", "application/json")},
    )
    assert resp.status_code == 422
    assert "Not a valid JSON file" in resp.text


def test_one_file_object_on_its_own_is_taken_as_a_list_of_one(editor_client):
    eid = editor_client.post("/emitters", json={"name": "Preview import"}).json()["id"]
    [one] = _file(_set("SET-1", _seq("Train", _pri(1, 800), _pri(2, 900))))
    body = _upload(editor_client, eid, one, "json-import/preview").json()
    assert [s["source_name"] for s in body["sets"]] == ["SET-1"]
