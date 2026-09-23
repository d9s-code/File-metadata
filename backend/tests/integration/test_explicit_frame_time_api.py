import io
import re
import zipfile

import pytest

from tests.integration.test_prs_import_api import FIXED_LINE, STAGGER_LINE  # STAGGER_LINE sums to 450 µs


@pytest.fixture()
def stagger_ctx(editor_client):
    e = editor_client.post("/emitters", json={"name": "Frame Time Emitter"}).json()
    g = editor_client.post(f"/emitters/{e['id']}/ew-groups", json={"name": "Search"}).json()
    s = editor_client.post(f"/emitters/{e['id']}/sources", json={"name": "S", "source_date": "2025-01-01"}).json()
    return {"eid": e["id"], "gid": g["id"], "sid": s["id"]}


def _create(client, ctx, name, line, pri_type="stagger"):
    return client.post(
        f"/ew-groups/{ctx['gid']}/modes",
        json={"source_id": ctx["sid"], "name": name, "pri_type": pri_type, "line": line},
    )


def _frame_period(xml: str, mode_name: str) -> tuple[str, str]:
    block = xml[xml.index(f'Name="{mode_name}"') :]
    m = re.search(r'<FramePeriod Min="([^"]+)" Max="([^"]+)"', block)
    return m.group(1), m.group(2)


def test_without_explicit_frame_time_the_sum_is_used(editor_client, stagger_ctx):
    line = _create(editor_client, stagger_ctx, "Summed", STAGGER_LINE).json()["line"]
    assert line["explicit_frame_time_us"] is None
    assert line["frame_time_us"] == 450
    assert (line["engineered_frame_time_min_us"], line["engineered_frame_time_max_us"]) == (445, 455)


def test_explicit_frame_time_overrides_the_sum(editor_client, stagger_ctx):
    resp = _create(editor_client, stagger_ctx, "Explicit", {**STAGGER_LINE, "explicit_frame_time_us": 500.12345})
    assert resp.status_code == 201, resp.text
    line = resp.json()["line"]
    assert line["explicit_frame_time_us"] == 500.123  # cut to 3 decimals
    assert line["frame_time_us"] == 500.123
    assert (line["engineered_frame_time_min_us"], line["engineered_frame_time_max_us"]) == (495.123, 505.123)


@pytest.mark.parametrize("bad", [0, -5])
def test_explicit_frame_time_must_be_positive(editor_client, stagger_ctx, bad):
    resp = _create(editor_client, stagger_ctx, "Bad", {**STAGGER_LINE, "explicit_frame_time_us": bad})
    assert resp.status_code == 422


def test_explicit_frame_time_is_stagger_only(editor_client, stagger_ctx):
    resp = _create(editor_client, stagger_ctx, "Fixed", {**FIXED_LINE, "explicit_frame_time_us": 500}, pri_type="fixed")
    assert resp.status_code == 422
    assert "explicit_frame_time_us" in resp.text


def test_explicit_frame_time_can_be_cleared_back_to_the_sum(editor_client, stagger_ctx):
    mode = _create(editor_client, stagger_ctx, "Clearable", {**STAGGER_LINE, "explicit_frame_time_us": 500}).json()
    resp = editor_client.patch(
        f"/ew-groups/{stagger_ctx['gid']}/modes/{mode['id']}", json={"line": {**STAGGER_LINE, "explicit_frame_time_us": None}}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["line"]["explicit_frame_time_us"] is None
    assert resp.json()["line"]["frame_time_us"] == 450


def test_both_exports_use_the_explicit_frame_time(editor_client, stagger_ctx):
    eid = stagger_ctx["eid"]
    _create(editor_client, stagger_ctx, "Explicit", {**STAGGER_LINE, "explicit_frame_time_us": 500})
    _create(editor_client, stagger_ctx, "Summed", STAGGER_LINE)

    zf = zipfile.ZipFile(io.BytesIO(editor_client.post(f"/emitters/{eid}/export/xml").content))
    button_xml = zf.read(zf.namelist()[0]).decode()
    assert _frame_period(button_xml, "Explicit") == ("495.0000", "505.0000")
    assert _frame_period(button_xml, "Summed") == ("445.0000", "455.0000")

    version = editor_client.post(f"/emitters/{eid}/versions", json={"change_summary": "v1"}).json()
    platform = editor_client.post("/platforms", json={"name": "FT Platform"}).json()
    editor_client.post(f"/platforms/{platform['id']}/links", json={"emitter_id": eid, "emitter_version_id": version["id"]})
    pv = editor_client.post(f"/platforms/{platform['id']}/versions", json={}).json()
    prs = zipfile.ZipFile(
        io.BytesIO(editor_client.get(f"/platforms/{platform['id']}/versions/{pv['version_number']}/export/prs").content)
    )
    versioned_xml = prs.read("emitters/Frame_Time_Emitter.xml").decode()
    assert _frame_period(versioned_xml, "Explicit") == ("495", "505")
    assert _frame_period(versioned_xml, "Summed") == ("445", "455")


def test_prs_import_restores_explicit_frame_time_and_delta(editor_client, stagger_ctx):
    eid = stagger_ctx["eid"]
    _create(editor_client, stagger_ctx, "Explicit", {**STAGGER_LINE, "explicit_frame_time_us": 500})
    _create(editor_client, stagger_ctx, "Summed", STAGGER_LINE)
    zf = zipfile.ZipFile(io.BytesIO(editor_client.post(f"/emitters/{eid}/export/xml").content))
    xml_bytes = zf.read(zf.namelist()[0])

    target = editor_client.post("/emitters", json={"name": "FT Import Target"}).json()
    resp = editor_client.post(
        f"/emitters/{target['id']}/imports/prs-import",
        files={"file": ("e.xml", xml_bytes, "application/xml")},
        data={"new_source_name": "Imported"},
    )
    assert resp.status_code == 201, resp.text
    by_name = {m["name"]: m["line"] for m in editor_client.get(f"/emitters/{target['id']}/modes").json()}
    assert (by_name["Explicit"]["explicit_frame_time_us"], by_name["Explicit"]["frame_time_delta_us"]) == (500, 5)
    assert (by_name["Summed"]["explicit_frame_time_us"], by_name["Summed"]["frame_time_delta_us"]) == (None, 5)
    assert by_name["Explicit"]["engineered_frame_time_max_us"] == 505


def test_explicit_frame_time_is_versioned_and_reverted(editor_client, stagger_ctx):
    eid = stagger_ctx["eid"]
    mode = _create(editor_client, stagger_ctx, "Versioned", STAGGER_LINE).json()
    editor_client.post(f"/emitters/{eid}/versions", json={"change_summary": "v1"})
    editor_client.patch(
        f"/ew-groups/{stagger_ctx['gid']}/modes/{mode['id']}", json={"line": {**STAGGER_LINE, "explicit_frame_time_us": 480}}
    )
    editor_client.post(f"/emitters/{eid}/versions", json={"change_summary": "v2"})
    entries = editor_client.get(f"/emitters/{eid}/versions/2/diff").json()["entries"]
    assert [(e["old_value"], e["new_value"]) for e in entries if e["label"] == "Frame Time (µs, written in)"] == [(None, 480)]

    editor_client.post(f"/emitters/{eid}/versions/1/revert")
    reverted = editor_client.get(f"/emitters/{eid}/modes").json()[0]["line"]
    assert reverted["explicit_frame_time_us"] is None


def test_test_runs_can_log_an_observed_frame_time_for_stagger(editor_client, stagger_ctx):
    mode = _create(editor_client, stagger_ctx, "Observed", STAGGER_LINE).json()
    base = {"test_type": "intercept", "title": "FT intercept", "test_date": "2026-09-01"}
    ok = editor_client.post(
        f"/emitters/{stagger_ctx['eid']}/test-records",
        json={
            **base,
            "mode_results": [
                {
                    "mode_id": mode["id"],
                    "result": "pass",
                    "observed_values": [{"pri_type": "stagger", "pri_stagger_values_us": [100, 150], "frame_time_us": 251.5}],
                }
            ],
        },
    )
    assert ok.status_code == 201, ok.text
    assert ok.json()["modes"][0]["observed_values"][0]["frame_time_us"] == 251.5

    bad = editor_client.post(
        f"/emitters/{stagger_ctx['eid']}/test-records",
        json={
            **base,
            "mode_results": [
                {"mode_id": mode["id"], "result": "pass", "observed_values": [{"pri_type": "fixed", "frame_time_us": 250}]}
            ],
        },
    )
    assert bad.status_code == 422
