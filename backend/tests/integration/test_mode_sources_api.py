"""A Mode can come from more than one Source."""

import io
import zipfile

import pytest

from app.core.enums import SourceStatus
from app.models.source import Source
from tests.integration.test_modes_api import FIXED_LINE


@pytest.fixture()
def ctx(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Multi Source Emitter"}).json()
    eid = emitter["id"]
    group = editor_client.post(f"/emitters/{eid}/ew-groups", json={"name": "Search"}).json()

    def source(name):
        return editor_client.post(f"/emitters/{eid}/sources", json={"name": name, "source_date": "2025-01-01"}).json()

    return {"eid": eid, "group": group, "a": source("Report A"), "b": source("Report B"), "c": source("Report C")}


def _mode(client, ctx, name, source_ids, **line):
    resp = client.post(
        f"/ew-groups/{ctx['group']['id']}/modes",
        json={"source_ids": source_ids, "name": name, "pri_type": "fixed", "line": {**FIXED_LINE, **line}},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_a_mode_is_created_with_several_sources(editor_client, ctx):
    mode = _mode(editor_client, ctx, "Search 1", [ctx["a"]["id"], ctx["b"]["id"]])
    assert mode["source_ids"] == [ctx["a"]["id"], ctx["b"]["id"]]
    assert mode["source_names"] == ["Report A", "Report B"]
    assert mode["source_id"] == ctx["a"]["id"]
    listed = editor_client.get(f"/emitters/{ctx['eid']}/modes").json()
    assert listed[0]["source_names"] == ["Report A", "Report B"]


def test_a_single_source_id_still_works_and_a_source_is_required(editor_client, ctx):
    url = f"/ew-groups/{ctx['group']['id']}/modes"
    one = editor_client.post(url, json={"source_id": ctx["a"]["id"], "name": "One", "pri_type": "fixed", "line": FIXED_LINE})
    assert one.status_code == 201 and one.json()["source_names"] == ["Report A"]
    none = editor_client.post(url, json={"source_ids": [], "name": "None", "pri_type": "fixed", "line": FIXED_LINE})
    assert none.status_code == 422


def test_a_source_from_another_emitter_is_refused(editor_client, ctx):
    other = editor_client.post("/emitters", json={"name": "Other Emitter"}).json()
    foreign = editor_client.post(
        f"/emitters/{other['id']}/sources", json={"name": "Foreign", "source_date": "2025-01-01"}
    ).json()
    resp = editor_client.post(
        f"/ew-groups/{ctx['group']['id']}/modes",
        json={"source_ids": [ctx["a"]["id"], foreign["id"]], "name": "X", "pri_type": "fixed", "line": FIXED_LINE},
    )
    assert resp.status_code == 422


def test_editing_the_sources_replaces_them_and_is_audited(editor_client, ctx):
    mode = _mode(editor_client, ctx, "Search 1", [ctx["a"]["id"]])
    resp = editor_client.patch(
        f"/ew-groups/{ctx['group']['id']}/modes/{mode['id']}", json={"source_ids": [ctx["c"]["id"], ctx["a"]["id"]]}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["source_names"] == ["Report C", "Report A"]
    log = editor_client.get("/audit-log", params={"entity_type": "mode", "entity_id": mode["id"]}).json()
    items = log["items"] if isinstance(log, dict) else log
    assert items[0]["changes"]["sources"] == {"old": "Report A", "new": "Report C, Report A"}


def test_deleting_a_source_keeps_modes_that_have_another(editor_client, ctx):
    shared = _mode(editor_client, ctx, "Shared", [ctx["a"]["id"], ctx["b"]["id"]])
    only_c = _mode(editor_client, ctx, "Only C", [ctx["c"]["id"]], rf_min_mhz=5000, rf_max_mhz=5100)

    # Report C is the only Source of "Only C": refused, and it says which.
    refused = editor_client.delete(f"/emitters/{ctx['eid']}/sources/{ctx['c']['id']}")
    assert refused.status_code == 409 and "Only C" in refused.text

    # Report A is the first Source of "Shared", which also has Report B.
    assert editor_client.delete(f"/emitters/{ctx['eid']}/sources/{ctx['a']['id']}").status_code == 204
    modes = {m["name"]: m for m in editor_client.get(f"/emitters/{ctx['eid']}/modes").json()}
    assert modes["Shared"]["source_names"] == ["Report B"]
    assert modes["Only C"]["id"] == only_c["id"] and shared["id"] == modes["Shared"]["id"]


def _export_xml(client, eid) -> str:
    resp = client.post(f"/emitters/{eid}/export/xml")
    assert resp.status_code == 200, resp.text
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    return zf.read(zf.namelist()[0]).decode()


def test_a_mode_is_left_out_only_when_all_its_sources_are_rejected(editor_client, db_session, ctx):
    _mode(editor_client, ctx, "BackedUp", [ctx["a"]["id"], ctx["b"]["id"]])
    _mode(editor_client, ctx, "OnlyRejected", [ctx["a"]["id"]], rf_min_mhz=5000, rf_max_mhz=5100)
    db_session.get(Source, ctx["a"]["id"]).status = SourceStatus.pending_review
    db_session.commit()
    resp = editor_client.post(f"/emitters/{ctx['eid']}/sources/{ctx['a']['id']}/reject", json={"reason": "Wrong emitter"})
    assert resp.status_code == 200, resp.text

    xml = _export_xml(editor_client, ctx["eid"])
    assert 'Name="BackedUp"' in xml
    assert 'Name="OnlyRejected"' not in xml


def test_sources_are_in_versions_and_their_diff(editor_client, ctx):
    mode = _mode(editor_client, ctx, "Search 1", [ctx["a"]["id"], ctx["b"]["id"]])
    editor_client.post(f"/emitters/{ctx['eid']}/versions", json={"change_summary": "two sources"})
    snapshot = editor_client.get(f"/emitters/{ctx['eid']}/versions/1").json()["snapshot"]
    snap_mode = snapshot["ew_groups"][0]["modes"][0]
    assert snap_mode["source_names"] == ["Report A", "Report B"]
    assert snap_mode["extra_source_ids"] == [ctx["b"]["id"]]

    editor_client.patch(f"/ew-groups/{ctx['group']['id']}/modes/{mode['id']}", json={"source_ids": [ctx["a"]["id"]]})
    editor_client.post(f"/emitters/{ctx['eid']}/versions", json={"change_summary": "one source"})
    entries = editor_client.get(f"/emitters/{ctx['eid']}/versions/2/diff").json()["entries"]
    change = next(e for e in entries if e["label"] == "Sources")
    assert (change["old_value"], change["new_value"]) == ("Report A, Report B", "Report A")


def test_batch_edit_adds_a_source_or_replaces_them(editor_client, ctx):
    m1 = _mode(editor_client, ctx, "M1", [ctx["a"]["id"]])
    m2 = _mode(editor_client, ctx, "M2", [ctx["b"]["id"]], rf_min_mhz=5000, rf_max_mhz=5100)
    url = f"/emitters/{ctx['eid']}/modes/batch-edit"
    resp = editor_client.post(url, json={"mode_ids": [m1["id"], m2["id"]], "fields": {"add_source_id": ctx["b"]["id"]}})
    assert resp.status_code == 200, resp.text
    modes = {m["name"]: m["source_names"] for m in editor_client.get(f"/emitters/{ctx['eid']}/modes").json()}
    assert modes == {"M1": ["Report A", "Report B"], "M2": ["Report B"]}

    resp = editor_client.post(url, json={"mode_ids": [m1["id"], m2["id"]], "fields": {"source_id": ctx["c"]["id"]}})
    assert resp.status_code == 200, resp.text
    modes = {m["name"]: m["source_names"] for m in editor_client.get(f"/emitters/{ctx['eid']}/modes").json()}
    assert modes == {"M1": ["Report C"], "M2": ["Report C"]}
