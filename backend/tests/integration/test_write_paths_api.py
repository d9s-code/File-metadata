"""Write paths that had no direct test coverage before the audit."""

import json

import pytest

from tests.integration.test_prs_import_api import FIXED_LINE


@pytest.fixture()
def emitter(editor_client):
    return editor_client.post("/emitters", json={"name": "Write Paths"}).json()


@pytest.fixture()
def source(editor_client, emitter):
    return editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "S1", "source_date": "2025-01-01"}
    ).json()


IMPORT_PAYLOAD = {
    "document_name": "Report 7",
    "document_reference": "R-7",
    "parametric_sets": [
        {
            "source_name": "Set A",
            "source_date": "2025-02-01",
            "elements": [{"element_type": "rf", "value_min": 2900, "value_max": 3100}],
            "sequences": [{"label": "Seq", "steps": [{"order": 1, "pri_us": 100}, {"order": 2, "pri_us": 150}]}],
        }
    ],
}

JSON_FILE = [
    {
        "file": "report7.xml",
        "notation": "R-7",
        "parametric_sets": [
            {
                "set_id": "SET-1",
                "date_last_updated": "10-06-2015 17:19:28 GMT",
                "groups": [
                    {"type": "independent", "kind": "rf", "values": [{"sub_kind": "rf-typical", "value": {"min": "2900", "max": "3100"}}]},
                    {"type": "sequence", "name": "Seq A", "steps": [{"step-num": "1", "pri-value": {"min": "100", "max": "100"}}]},
                ],
            }
        ],
    }
]


# --- JSON import -----------------------------------------------------------


def test_import_validate_reports_valid_and_invalid_payloads(editor_client, emitter):
    ok = editor_client.post(f"/emitters/{emitter['id']}/imports/validate", json=IMPORT_PAYLOAD)
    assert ok.status_code == 200, ok.text
    assert ok.json()["valid"] is True
    assert ok.json()["element_count"] == 1
    assert ok.json()["sequence_count"] == 1

    bad = {**IMPORT_PAYLOAD, "parametric_sets": []}
    assert editor_client.post(f"/emitters/{emitter['id']}/imports/validate", json=bad).status_code == 422


def test_import_commit_creates_pending_sources_with_elements_and_sequences(editor_client, emitter):
    resp = editor_client.post(f"/emitters/{emitter['id']}/imports", json=IMPORT_PAYLOAD)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert (body["source_count"], body["element_count"], body["sequence_count"]) == (1, 1, 1)

    sources = editor_client.get(f"/emitters/{emitter['id']}/sources").json()
    created = next(s for s in sources if s["name"] == "Set A")
    assert created["status"] == "pending_review"
    assert created["import_batch_id"] == body["import_batch"]["id"]


def test_json_file_import_round_trip(editor_client, emitter):
    resp = editor_client.post(
        f"/emitters/{emitter['id']}/imports/json-import",
        files={"file": ("report7.json", json.dumps(JSON_FILE).encode(), "application/json")},
        data={"source_date": "2026-03-01"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["source_count"] == 1

    created = next(s for s in editor_client.get(f"/emitters/{emitter['id']}/sources").json() if s["name"] == "SET-1")
    assert created["source_date"] == "2026-03-01"  # the manual date overrides the file's own


@pytest.mark.parametrize(
    "content",
    [b"not json at all", b"\xff\xfe\x00", json.dumps({"file": "not a list"}).encode(), json.dumps([]).encode()],
)
def test_json_file_import_rejects_malformed_files_with_422(editor_client, emitter, content):
    resp = editor_client.post(
        f"/emitters/{emitter['id']}/imports/json-import", files={"file": ("bad.json", content, "application/json")}
    )
    assert resp.status_code == 422, resp.text


def test_json_file_import_unknown_source_group_is_404(editor_client, emitter):
    resp = editor_client.post(
        f"/emitters/{emitter['id']}/imports/json-import",
        files={"file": ("r.json", json.dumps(JSON_FILE).encode(), "application/json")},
        data={"group_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert resp.status_code == 404


# --- Sources ----------------------------------------------------------------


def test_source_update_and_delete(editor_client, emitter, source):
    base = f"/emitters/{emitter['id']}/sources/{source['id']}"
    resp = editor_client.patch(base, json={"name": "S1 renamed", "description": "d"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "S1 renamed"
    assert editor_client.delete(base).status_code == 204
    assert all(s["id"] != source["id"] for s in editor_client.get(f"/emitters/{emitter['id']}/sources").json())


def test_source_with_modes_cannot_be_deleted(editor_client, emitter, source):
    group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "G"}).json()
    editor_client.post(
        f"/ew-groups/{group['id']}/modes",
        json={"source_id": source["id"], "name": "M", "pri_type": "fixed", "line": FIXED_LINE},
    )
    assert editor_client.delete(f"/emitters/{emitter['id']}/sources/{source['id']}").status_code == 409


# --- Parameter sequences ----------------------------------------------------


def test_parameter_sequence_lifecycle(editor_client, emitter, source):
    base = f"/emitters/{emitter['id']}/sources/{source['id']}/parameter-sequences"
    created = editor_client.post(
        base, json={"label": "Seq", "steps": [{"order": 1, "pri_us": 100}, {"order": 2, "pri_us": 150}]}
    )
    assert created.status_code == 201, created.text
    seq_id = created.json()["id"]
    assert [s["id"] for s in editor_client.get(base).json()] == [seq_id]

    patched = editor_client.patch(f"{base}/{seq_id}", json={"pri_delta": 2.5})
    assert patched.status_code == 200, patched.text
    assert patched.json()["pri_delta"] == 2.5

    assert editor_client.delete(f"{base}/{seq_id}/steps/2").status_code == 204
    assert [s["order"] for s in editor_client.get(base).json()[0]["steps"]] == [1]
    assert editor_client.delete(f"{base}/{seq_id}/steps/9").status_code == 404

    assert editor_client.delete(f"{base}/{seq_id}").status_code == 204
    assert editor_client.get(base).json() == []


def test_parameter_sequence_rejects_duplicate_step_orders(editor_client, emitter, source):
    base = f"/emitters/{emitter['id']}/sources/{source['id']}/parameter-sequences"
    resp = editor_client.post(base, json={"steps": [{"order": 1, "pri_us": 1}, {"order": 1, "pri_us": 2}]})
    assert resp.status_code == 422


# --- Source groups ----------------------------------------------------------


def test_source_group_lifecycle(editor_client, admin_client, emitter, source):
    assert editor_client.post("/source-groups/", json={"name": "Nope"}).status_code == 403  # admin only
    created = admin_client.post("/source-groups/", json={"name": "Group A", "description": "first"})
    assert created.status_code == 201, created.text
    gid = created.json()["id"]

    editor_client.patch(f"/emitters/{emitter['id']}/sources/{source['id']}", json={"group_id": gid})
    fetched = editor_client.get(f"/source-groups/{gid}").json()
    assert fetched["source_count"] == 1
    assert gid in [g["id"] for g in editor_client.get("/source-groups/").json()]

    assert editor_client.patch(f"/source-groups/{gid}", json={"name": "Group B"}).status_code == 403
    renamed = admin_client.patch(f"/source-groups/{gid}", json={"name": "Group B"})
    assert renamed.status_code == 200 and renamed.json()["name"] == "Group B"

    assert editor_client.delete(f"/source-groups/{gid}").status_code == 403
    assert admin_client.delete(f"/source-groups/{gid}").status_code == 204
    assert editor_client.get(f"/source-groups/{gid}").status_code == 404
    source_after = next(s for s in editor_client.get(f"/emitters/{emitter['id']}/sources").json() if s["id"] == source["id"])
    assert source_after["group_id"] is None


# --- EW Groups and Test Records --------------------------------------------


def test_ew_group_delete_cascades_its_modes(editor_client, emitter, source):
    group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Doomed"}).json()
    editor_client.post(
        f"/ew-groups/{group['id']}/modes",
        json={"source_id": source["id"], "name": "M", "pri_type": "fixed", "line": FIXED_LINE},
    )
    assert editor_client.delete(f"/emitters/{emitter['id']}/ew-groups/{group['id']}").status_code == 204
    assert editor_client.get(f"/emitters/{emitter['id']}/modes").json() == []


def test_emitter_test_record_delete(editor_client, emitter):
    base = f"/emitters/{emitter['id']}/test-records"
    record = editor_client.post(
        base, json={"test_type": "field_exercise", "result": "pass", "title": "Run", "test_date": "2026-01-03"}
    ).json()
    assert editor_client.delete(f"{base}/{record['id']}").status_code == 204
    assert editor_client.get(base).json() == []


# --- Trash and restore ------------------------------------------------------


def test_trash_lists_and_purges_deleted_entities(editor_client, admin_client, emitter):
    editor_client.delete(f"/emitters/{emitter['id']}")
    listed = admin_client.get("/trash").json()
    assert any(item["id"] == emitter["id"] for item in listed)

    assert editor_client.delete(f"/trash/emitter/{emitter['id']}").status_code == 403
    assert admin_client.delete(f"/trash/bogus/{emitter['id']}").status_code == 404
    assert admin_client.delete(f"/trash/emitter/{emitter['id']}").status_code == 204
    assert editor_client.get(f"/emitters/{emitter['id']}").status_code == 404


def test_trash_refuses_to_purge_a_live_entity(editor_client, admin_client, emitter):
    assert admin_client.delete(f"/trash/emitter/{emitter['id']}").status_code == 404


@pytest.mark.parametrize("path", ["/platforms", "/mdfs"])
def test_platform_and_mdf_restore(editor_client, path):
    entity = editor_client.post(path, json={"name": f"Restorable {path}"}).json()
    editor_client.delete(f"{path}/{entity['id']}")
    resp = editor_client.post(f"{path}/{entity['id']}/restore")
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_deleted"] is False
