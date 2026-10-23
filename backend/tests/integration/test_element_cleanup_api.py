"""Cleaning up imported Elements across an Emitter's Sources: every Element
picked (by name or value on the page) deleted at once."""

from tests.integration.test_checkout_guards_api import other_editor  # noqa: F401 - fixture


def _emitter(client, name, sources=("Alpha", "Bravo")):
    emitter = client.post("/emitters", json={"name": name}).json()
    made = {
        s: client.post(f"/emitters/{emitter['id']}/sources", json={"name": s, "source_date": "2026-01-01"}).json()
        for s in sources
    }
    return emitter, made


def _add(client, emitter, source, **element):
    resp = client.post(f"/emitters/{emitter['id']}/sources/{source['id']}/elements", json=element)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _elements(client, emitter, source):
    return client.get(f"/emitters/{emitter['id']}/sources/{source['id']}/elements").json()


def test_deletes_the_elements_picked_from_every_source(editor_client):
    emitter, s = _emitter(editor_client, "Cleanup Emitter")
    scan_a = _add(editor_client, emitter, s["Alpha"], element_type="scan", value_min=2, value_max=2, label="Scan rate")
    scan_b = _add(editor_client, emitter, s["Bravo"], element_type="scan", value_min=4, value_max=4, label="Scan rate")
    pri_zero = _add(editor_client, emitter, s["Bravo"], element_type="pri", value_min=0, value_max=0, jitter_min=0, jitter_max=0)
    rf = _add(editor_client, emitter, s["Alpha"], element_type="rf", value_min=9000, value_max=9000, label="RF")

    resp = editor_client.post(
        f"/emitters/{emitter['id']}/elements/delete",
        json={"element_ids": [scan_a["id"], scan_b["id"], pri_zero["id"]]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"deleted": 3, "sources": 2}
    assert [e["id"] for e in _elements(editor_client, emitter, s["Alpha"])] == [rf["id"]]
    assert _elements(editor_client, emitter, s["Bravo"]) == []

    audit = editor_client.get("/audit-log", params={"emitter_id": emitter["id"]}).json()
    entries = audit["items"] if isinstance(audit, dict) else audit
    summaries = {e["summary"] for e in entries}
    assert "Cleaned up 1 element (Scan rate) from Source 'Alpha'" in summaries
    assert "Cleaned up 2 elements (Scan rate) from Source 'Bravo'" in summaries


def test_refuses_the_lot_when_one_isnt_in_this_emitters_sources(editor_client):
    emitter, s = _emitter(editor_client, "Cleanup Mine")
    other, o = _emitter(editor_client, "Cleanup Other", sources=("Other",))
    mine = _add(editor_client, emitter, s["Alpha"], element_type="rf", value_min=9000, value_max=9000)
    theirs = _add(editor_client, other, o["Other"], element_type="rf", value_min=9000, value_max=9000)

    resp = editor_client.post(f"/emitters/{emitter['id']}/elements/delete", json={"element_ids": [mine["id"], theirs["id"]]})
    assert resp.status_code == 409
    assert len(_elements(editor_client, emitter, s["Alpha"])) == 1
    assert len(_elements(editor_client, other, o["Other"])) == 1


def test_needs_the_emitter_checked_out(editor_client, other_editor):  # noqa: F811
    emitter, s = _emitter(editor_client, "Cleanup Locked")
    element = _add(editor_client, emitter, s["Alpha"], element_type="rf", value_min=9000, value_max=9000)
    resp = other_editor.post(f"/emitters/{emitter['id']}/elements/delete", json={"element_ids": [element["id"]]})
    assert resp.status_code == 409
    assert len(_elements(editor_client, emitter, s["Alpha"])) == 1
