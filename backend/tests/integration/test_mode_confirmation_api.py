import io
import re
import zipfile

import pytest

from tests.integration.test_prs_import_api import FIXED_LINE


@pytest.fixture()
def ctx(editor_client):
    e = editor_client.post("/emitters", json={"name": "Confirmation Emitter"}).json()
    g = editor_client.post(f"/emitters/{e['id']}/ew-groups", json={"name": "Search"}).json()
    s = editor_client.post(f"/emitters/{e['id']}/sources", json={"name": "S", "source_date": "2025-01-01"}).json()
    return {"eid": e["id"], "gid": g["id"], "sid": s["id"]}


def _create(client, ctx, name, **extra):
    return client.post(
        f"/ew-groups/{ctx['gid']}/modes",
        json={"source_id": ctx["sid"], "name": name, "pri_type": "fixed", "line": FIXED_LINE, **extra},
    )


def _confirmation(xml: str, mode_name: str) -> tuple[str, str]:
    block = xml[xml.index(f'Name="{mode_name}"') :]
    quality = re.search(r'<ConfirmationQuality Value="([^"]+)"', block).group(1)
    quantity = re.search(r'<ConfirmationQuantity Value="([^"]+)"', block).group(1)
    return quality, quantity


def _button_xml(client, eid) -> bytes:
    zf = zipfile.ZipFile(io.BytesIO(client.post(f"/emitters/{eid}/export/xml").content))
    return zf.read(zf.namelist()[0])


def test_defaults_are_100_and_2(editor_client, ctx):
    mode = _create(editor_client, ctx, "Defaults").json()
    assert (mode["confirmation_quality"], mode["confirmation_quantity"]) == (100, 2)


def test_explicit_values_are_stored(editor_client, ctx):
    resp = _create(editor_client, ctx, "Explicit", confirmation_quality=75, confirmation_quantity=1)
    assert resp.status_code == 201, resp.text
    assert (resp.json()["confirmation_quality"], resp.json()["confirmation_quantity"]) == (75, 1)


@pytest.mark.parametrize(
    "bad", [{"confirmation_quality": 101}, {"confirmation_quality": -1}, {"confirmation_quantity": 0}]
)
def test_out_of_range_values_are_rejected(editor_client, ctx, bad):
    assert _create(editor_client, ctx, "Bad", **bad).status_code == 422


def test_patch_is_audited(editor_client, ctx):
    mode = _create(editor_client, ctx, "Patched").json()
    resp = editor_client.patch(
        f"/ew-groups/{ctx['gid']}/modes/{mode['id']}", json={"confirmation_quality": 80, "confirmation_quantity": 3}
    )
    assert resp.status_code == 200, resp.text
    entry = editor_client.get(
        "/audit-log", params={"entity_type": "mode", "entity_id": mode["id"], "action": "update"}
    ).json()["items"][0]
    assert entry["changes"]["confirmation_quality"] == {"old": 100, "new": 80}
    assert entry["changes"]["confirmation_quantity"] == {"old": 2, "new": 3}


def test_batch_edit_sets_both_and_is_audited(editor_client, ctx):
    a = _create(editor_client, ctx, "A").json()
    b = _create(editor_client, ctx, "B", confirmation_quality=50).json()
    resp = editor_client.post(
        f"/emitters/{ctx['eid']}/modes/batch-edit",
        json={"mode_ids": [a["id"], b["id"]], "fields": {"confirmation_quality": 90, "confirmation_quantity": 4}},
    )
    assert resp.status_code == 200, resp.text
    modes = {m["id"]: m for m in editor_client.get(f"/emitters/{ctx['eid']}/modes").json()}
    for mid in (a["id"], b["id"]):
        assert (modes[mid]["confirmation_quality"], modes[mid]["confirmation_quantity"]) == (90, 4)

    entry = editor_client.get(
        "/audit-log", params={"entity_type": "mode", "entity_id": b["id"], "action": "update"}
    ).json()["items"][0]
    assert entry["changes"]["confirmation_quality"] == {"old": 50, "new": 90}
    assert entry["changes"]["confirmation_quantity"] == {"old": 2, "new": 4}


def test_batch_edit_rejects_out_of_range(editor_client, ctx):
    a = _create(editor_client, ctx, "A").json()
    resp = editor_client.post(
        f"/emitters/{ctx['eid']}/modes/batch-edit",
        json={"mode_ids": [a["id"]], "fields": {"confirmation_quality": 150}},
    )
    assert resp.status_code == 422


def test_both_exports_write_the_values_instead_of_placeholders(editor_client, ctx):
    eid = ctx["eid"]
    _create(editor_client, ctx, "Custom", confirmation_quality=65, confirmation_quantity=5)
    _create(editor_client, ctx, "Default")

    button_xml = _button_xml(editor_client, eid).decode()
    assert _confirmation(button_xml, "Custom") == ("65", "5")
    assert _confirmation(button_xml, "Default") == ("100", "2")

    version = editor_client.post(f"/emitters/{eid}/versions", json={"change_summary": "v1"}).json()
    platform = editor_client.post("/platforms", json={"name": "Conf Platform"}).json()
    editor_client.post(f"/platforms/{platform['id']}/links", json={"emitter_id": eid, "emitter_version_id": version["id"]})
    pv = editor_client.post(f"/platforms/{platform['id']}/versions", json={}).json()
    prs = zipfile.ZipFile(
        io.BytesIO(editor_client.get(f"/platforms/{platform['id']}/versions/{pv['version_number']}/export/prs").content)
    )
    versioned_xml = prs.read("emitters/Confirmation_Emitter.xml").decode()
    assert _confirmation(versioned_xml, "Custom") == ("65", "5")
    assert _confirmation(versioned_xml, "Default") == ("100", "2")


def _import(client, xml_bytes, target_name):
    target = client.post("/emitters", json={"name": target_name}).json()
    resp = client.post(
        f"/emitters/{target['id']}/imports/prs-import",
        files={"file": ("e.xml", xml_bytes, "application/xml")},
        data={"new_source_name": "Imported"},
    )
    return target, resp


def test_prs_import_round_trips_the_values(editor_client, ctx):
    _create(editor_client, ctx, "Custom", confirmation_quality=65, confirmation_quantity=5)
    target, resp = _import(editor_client, _button_xml(editor_client, ctx["eid"]), "Conf Import Target")
    assert resp.status_code == 201, resp.text
    mode = editor_client.get(f"/emitters/{target['id']}/modes").json()[0]
    assert (mode["confirmation_quality"], mode["confirmation_quantity"]) == (65, 5)


def test_prs_import_reports_out_of_range_values(editor_client, ctx):
    _create(editor_client, ctx, "Custom")
    xml = _button_xml(editor_client, ctx["eid"]).replace(
        b'<ConfirmationQuality Value="100"', b'<ConfirmationQuality Value="140"'
    )
    target, resp = _import(editor_client, xml, "Conf Import Bad")
    assert resp.status_code == 422
    assert "ConfirmationQuality" in resp.text
    assert editor_client.get(f"/emitters/{target['id']}/modes").json() == []


def test_values_are_versioned_and_reverted(editor_client, ctx):
    eid = ctx["eid"]
    mode = _create(editor_client, ctx, "Versioned").json()
    editor_client.post(f"/emitters/{eid}/versions", json={"change_summary": "v1"})
    editor_client.patch(f"/ew-groups/{ctx['gid']}/modes/{mode['id']}", json={"confirmation_quality": 70})
    editor_client.post(f"/emitters/{eid}/versions", json={"change_summary": "v2"})
    entries = editor_client.get(f"/emitters/{eid}/versions/2/diff").json()["entries"]
    assert [(e["old_value"], e["new_value"]) for e in entries if e["label"] == "Confirmation Quality (%)"] == [(100, 70)]

    editor_client.post(f"/emitters/{eid}/versions/1/revert")
    assert editor_client.get(f"/emitters/{eid}/modes").json()[0]["confirmation_quality"] == 100


def test_dsl_create_accepts_the_values(editor_client, ctx):
    resp = editor_client.post(
        f"/ew-groups/{ctx['gid']}/modes/from-dsl",
        json={
            "source_id": ctx["sid"],
            "name": "Typed",
            "dsl_text": "RF 2900-3100 PRI FIXED 800-1200 JITTER 5-15 PW 0.5-1.2",
            "confirmation_quality": 40,
            "confirmation_quantity": 1,
        },
    )
    assert resp.status_code == 201, resp.text
    assert (resp.json()["confirmation_quality"], resp.json()["confirmation_quantity"]) == (40, 1)
