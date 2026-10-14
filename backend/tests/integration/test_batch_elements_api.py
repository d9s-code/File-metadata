"""Adding Elements to several Sources at once: every Element to every
Source, each its own Element, all or nothing."""

import pytest


@pytest.fixture()
def two_sources(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Batch Element Emitter"}).json()
    sources = [
        editor_client.post(
            f"/emitters/{emitter['id']}/sources", json={"name": name, "source_date": "2026-02-01"}
        ).json()
        for name in ("Source A", "Source B")
    ]
    return emitter, sources


def _batch(client, emitter, source_ids, elements):
    return client.post(
        f"/emitters/{emitter['id']}/sources/batch-elements", json={"source_ids": source_ids, "elements": elements}
    )


def _elements(client, emitter, source):
    return client.get(f"/emitters/{emitter['id']}/sources/{source['id']}/elements").json()


def test_every_value_becomes_its_own_element_on_every_source(editor_client, two_sources):
    emitter, sources = two_sources
    # One already there: the new ones come after it.
    editor_client.post(
        f"/emitters/{emitter['id']}/sources/{sources[0]['id']}/elements",
        json={"element_type": "rf", "value_min": 100, "value_max": 100},
    )
    elements = [
        {"element_type": "rf", "variant": "discrete", "value_min": v[0], "value_max": v[1], "delta": 5}
        for v in ((9000, 9000), (9100, 9200), (9300, 9300))
    ]
    resp = _batch(editor_client, emitter, [s["id"] for s in sources], elements)
    assert resp.status_code == 201, resp.text
    assert resp.json() == {"created": 6, "sources": 2}

    first = sorted(_elements(editor_client, emitter, sources[0]), key=lambda e: e["sort_order"])
    assert [(e["value_min"], e["value_max"], e["sort_order"]) for e in first] == [
        (100, 100, 0),
        (9000, 9000, 1),
        (9100, 9200, 2),
        (9300, 9300, 3),
    ]
    assert all(e["variant"] == "discrete" and e["delta"] == 5 for e in first[1:])
    assert len(_elements(editor_client, emitter, sources[1])) == 3

    audit = editor_client.get(f"/audit-log?emitter_id={emitter['id']}").json()
    rows = audit["items"] if isinstance(audit, dict) else audit
    summaries = [r["summary"] for r in rows]
    assert "Added 3 RF elements to Source 'Source B' (batch)" in summaries


def test_one_bad_element_or_source_adds_nothing(editor_client, two_sources):
    emitter, sources = two_sources
    good = {"element_type": "pw", "value_min": 1, "value_max": 2}
    bad = {"element_type": "pw", "value_min": 3, "value_max": 2}
    assert _batch(editor_client, emitter, [sources[0]["id"]], [good, bad]).status_code == 422

    other = editor_client.post("/emitters", json={"name": "Someone Else's"}).json()
    foreign = editor_client.post(
        f"/emitters/{other['id']}/sources", json={"name": "Elsewhere", "source_date": "2026-02-01"}
    ).json()
    resp = _batch(editor_client, emitter, [sources[0]["id"], foreign["id"]], [good])
    assert resp.status_code == 404
    assert _elements(editor_client, emitter, sources[0]) == []


def test_needs_the_emitter_checked_out(editor_client, viewer_client, two_sources):
    emitter, sources = two_sources
    resp = _batch(viewer_client, emitter, [sources[0]["id"]], [{"element_type": "rf", "value_min": 1, "value_max": 1}])
    assert resp.status_code == 403
