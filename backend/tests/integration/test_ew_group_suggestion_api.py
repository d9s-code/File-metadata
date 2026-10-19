"""An Emitter with no EW Group is offered one: the scan range from the
shortest to the longest scan time among its Sources' scan Elements."""


def _emitter(client):
    e = client.post("/emitters", json={"name": "Scan Emitter"}).json()
    return e["id"]


def _source(client, eid, name):
    return client.post(f"/emitters/{eid}/sources", json={"name": name, "source_date": "2025-03-01"}).json()["id"]


def test_suggestion_spans_every_sources_scan_times(editor_client):
    eid = _emitter(editor_client)
    url = f"/emitters/{eid}/ew-groups/suggestion"
    assert editor_client.get(url).json() is None

    a = _source(editor_client, eid, "Datasheet A")
    b = _source(editor_client, eid, "Datasheet B")
    editor_client.post(f"/emitters/{eid}/sources/{a}/elements", json={"element_type": "scan", "value_min": 4, "value_max": 6})
    editor_client.post(f"/emitters/{eid}/sources/{b}/elements", json={"element_type": "scan", "value_min": 2.5, "value_max": 2.5})
    editor_client.post(f"/emitters/{eid}/sources/{b}/elements", json={"element_type": "scan", "value_min": 9, "value_max": 12})
    # Other parameters don't count.
    editor_client.post(f"/emitters/{eid}/sources/{a}/elements", json={"element_type": "rf", "value_min": 1, "value_max": 99})

    s = editor_client.get(url).json()
    assert (s["scan_min"], s["scan_max"]) == (2.5, 12)
    assert s["element_count"] == 3 and s["source_names"] == ["Datasheet A", "Datasheet B"]


def test_another_emitters_scan_elements_are_not_used(editor_client):
    eid = _emitter(editor_client)
    other = editor_client.post("/emitters", json={"name": "Other"}).json()["id"]
    src = _source(editor_client, other, "Theirs")
    editor_client.post(f"/emitters/{other}/sources/{src}/elements", json={"element_type": "scan", "value_min": 1, "value_max": 3})
    assert editor_client.get(f"/emitters/{eid}/ew-groups/suggestion").json() is None
