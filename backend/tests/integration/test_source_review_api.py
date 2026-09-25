import io
import zipfile

import pytest

from app.core.enums import SourceStatus
from app.models.source import Source
from app.services.ambiguity_service import flatten_emitter_snapshot
from app.services.emitter_diff_service import compute_emitter_diff
from tests.integration.test_prs_import_api import CW_LINE, FIXED_LINE


@pytest.fixture()
def review_ctx(editor_client, db_session):
    """An Emitter with one approved Source and one pending-review Source,
    each backing one Mode in the same EW Group."""
    emitter = editor_client.post("/emitters", json={"name": "Review Emitter"}).json()
    eid = emitter["id"]
    group = editor_client.post(f"/emitters/{eid}/ew-groups", json={"name": "Search"}).json()
    kept = editor_client.post(f"/emitters/{eid}/sources", json={"name": "Kept", "source_date": "2025-01-01"}).json()
    pending = editor_client.post(f"/emitters/{eid}/sources", json={"name": "Imported", "source_date": "2025-01-02"}).json()
    db_session.get(Source, pending["id"]).status = SourceStatus.pending_review
    db_session.commit()
    for name, source, line, pri in [("KeptMode", kept, FIXED_LINE, "fixed"), ("ImportedMode", pending, CW_LINE, "cw")]:
        resp = editor_client.post(
            f"/ew-groups/{group['id']}/modes",
            json={"source_id": source["id"], "name": name, "pri_type": pri, "line": line},
        )
        assert resp.status_code == 201, resp.text
    return {"eid": eid, "pending_id": pending["id"], "kept_id": kept["id"]}


def _reject(client, eid, sid, reason="Duplicate of an older report"):
    return client.post(f"/emitters/{eid}/sources/{sid}/reject", json={"reason": reason})


def _button_export_xml(client, eid) -> str:
    resp = client.post(f"/emitters/{eid}/export/xml")
    assert resp.status_code == 200, resp.text
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    return zf.read(zf.namelist()[0]).decode()


def test_reject_requires_a_reason(editor_client, review_ctx):
    eid, sid = review_ctx["eid"], review_ctx["pending_id"]
    assert editor_client.post(f"/emitters/{eid}/sources/{sid}/reject", json={}).status_code == 422
    assert _reject(editor_client, eid, sid, reason="   ").status_code == 422


def test_reject_stores_reason_and_is_audited(editor_client, review_ctx):
    eid, sid = review_ctx["eid"], review_ctx["pending_id"]
    resp = _reject(editor_client, eid, sid)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "rejected"
    assert resp.json()["rejection_reason"] == "Duplicate of an older report"

    log = editor_client.get("/audit-log", params={"entity_type": "source", "entity_id": sid}).json()
    entry = next(e for e in log["items"] if e["action"] == "status_change")
    assert "Duplicate of an older report" in entry["summary"]
    assert entry["changes"]["rejection_reason"]["new"] == "Duplicate of an older report"


def test_rejected_source_can_be_approved_later(editor_client, review_ctx):
    eid, sid = review_ctx["eid"], review_ctx["pending_id"]
    _reject(editor_client, eid, sid)
    resp = editor_client.post(f"/emitters/{eid}/sources/{sid}/approve")
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "approved"
    assert resp.json()["rejection_reason"] is None

    log = editor_client.get("/audit-log", params={"entity_type": "source", "entity_id": sid}).json()
    summaries = [e["summary"] for e in log["items"]]
    assert any("Approved previously rejected Source" in s for s in summaries)


def test_approving_an_approved_source_is_409(editor_client, review_ctx):
    resp = editor_client.post(f"/emitters/{review_ctx['eid']}/sources/{review_ctx['kept_id']}/approve")
    assert resp.status_code == 409


def test_only_pending_sources_can_be_rejected(editor_client, review_ctx):
    assert _reject(editor_client, review_ctx["eid"], review_ctx["kept_id"]).status_code == 409


def test_review_requires_checkout(editor_client, review_ctx):
    eid, sid = review_ctx["eid"], review_ctx["pending_id"]
    editor_client.delete(f"/emitters/{eid}/checkout")
    assert _reject(editor_client, eid, sid).status_code == 409
    assert editor_client.post(f"/emitters/{eid}/sources/{sid}/approve").status_code == 409


def test_rejected_source_modes_are_left_out_of_the_xml_export(editor_client, review_ctx):
    eid, sid = review_ctx["eid"], review_ctx["pending_id"]
    before = _button_export_xml(editor_client, eid)
    assert "ImportedMode" in before and "KeptMode" in before

    _reject(editor_client, eid, sid)
    rejected = _button_export_xml(editor_client, eid)
    assert "ImportedMode" not in rejected
    assert "KeptMode" in rejected

    editor_client.post(f"/emitters/{eid}/sources/{sid}/approve")
    assert "ImportedMode" in _button_export_xml(editor_client, eid)


def test_rejected_source_modes_are_left_out_of_the_versioned_prs_export(editor_client, review_ctx):
    eid, sid = review_ctx["eid"], review_ctx["pending_id"]
    _reject(editor_client, eid, sid)
    version = editor_client.post(f"/emitters/{eid}/versions", json={"change_summary": "with rejection"}).json()
    platform = editor_client.post("/platforms", json={"name": "Review Platform"}).json()
    editor_client.post(f"/platforms/{platform['id']}/links", json={"emitter_id": eid, "emitter_version_id": version["id"]})
    pv = editor_client.post(f"/platforms/{platform['id']}/versions", json={}).json()

    resp = editor_client.get(f"/platforms/{platform['id']}/versions/{pv['version_number']}/export/prs")
    assert resp.status_code == 200, resp.text
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    emitter_xml = zf.read("emitters/Review_Emitter.xml").decode()
    assert "KeptMode" in emitter_xml
    assert "ImportedMode" not in emitter_xml


def test_rejected_source_modes_are_left_out_of_ambiguity_checks(editor_client, review_ctx):
    eid, sid = review_ctx["eid"], review_ctx["pending_id"]
    _reject(editor_client, eid, sid)
    editor_client.post(f"/emitters/{eid}/versions", json={"change_summary": "x"})
    snapshot = editor_client.get(f"/emitters/{eid}/versions/1").json()["snapshot"]
    assert {m.mode_name for m in flatten_emitter_snapshot(snapshot)} == {"KeptMode"}


def test_version_diff_shows_review_status_change(editor_client, review_ctx):
    eid, sid = review_ctx["eid"], review_ctx["pending_id"]
    editor_client.post(f"/emitters/{eid}/versions", json={"change_summary": "before"})
    _reject(editor_client, eid, sid)
    editor_client.post(f"/emitters/{eid}/versions", json={"change_summary": "after"})
    entries = editor_client.get(f"/emitters/{eid}/versions/2/diff").json()["entries"]
    by_field = {e["label"]: e for e in entries if e["scope"] == "Source 'Imported'"}
    assert by_field["Review Status"]["old_value"] == "Pending review"
    assert by_field["Review Status"]["new_value"] == "Rejected"
    assert by_field["Rejection Reason"]["new_value"] == "Duplicate of an older report"


def test_diff_ignores_status_missing_from_older_snapshots():
    old = {"sources": [{"id": "s1", "name": "S", "description": None, "source_date": "2025-01-01"}]}
    new = {"sources": [{**old["sources"][0], "status": "approved", "rejection_reason": None}]}
    assert compute_emitter_diff(old, new)["identical"] is True
