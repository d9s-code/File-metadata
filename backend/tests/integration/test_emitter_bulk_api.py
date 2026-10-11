"""Bulk actions from the Emitters list."""


def _emitters(client, *names, save=True):
    out = []
    for name in names:
        e = client.post("/emitters", json={"name": name}).json()
        if save:
            client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"})
        out.append(e)
    return out


def _results(resp):
    assert resp.status_code == 200, resp.text
    return {r["name"]: r for r in resp.json()["results"]}


def test_bulk_assign_and_status_apply_the_single_emitter_rules(editor_client):
    a, b = _emitters(editor_client, "Bulk A", "Bulk B")
    me = editor_client.get("/auth/me").json()
    resp = editor_client.post(
        "/emitters/bulk", json={"emitter_ids": [a["id"], b["id"]], "action": "assign", "assignee_id": me["id"]}
    )
    assert resp.json()["done"] == 2
    assert editor_client.get(f"/emitters/{a['id']}").json()["assignee_id"] == me["id"]

    # In progress -> Testing is allowed; doing it again is skipped as "already".
    resp = editor_client.post(
        "/emitters/bulk", json={"emitter_ids": [a["id"]], "action": "status", "new_status": "in_review"}
    )
    assert _results(resp)["Bulk A"]["ok"] is True
    resp = editor_client.post(
        "/emitters/bulk", json={"emitter_ids": [a["id"], b["id"]], "action": "status", "new_status": "in_review"}
    )
    results = _results(resp)
    assert results["Bulk A"] == {**results["Bulk A"], "ok": False, "message": "Already Testing"}
    assert results["Bulk B"]["ok"] is True

    # Testing -> Operational needs a note: without one each is skipped with the reason.
    resp = editor_client.post(
        "/emitters/bulk", json={"emitter_ids": [a["id"]], "action": "status", "new_status": "validated"}
    )
    assert _results(resp)["Bulk A"]["ok"] is False
    assert "required" in _results(resp)["Bulk A"]["message"]


def test_bulk_pin_pins_each_latest_saved_version_and_skips_unsaved(editor_client):
    saved, = _emitters(editor_client, "Bulk Saved")
    unsaved, = _emitters(editor_client, "Bulk Unsaved", save=False)
    platform = editor_client.post("/platforms", json={"name": "Bulk Platform"}).json()
    resp = editor_client.post(
        "/emitters/bulk",
        json={"emitter_ids": [saved["id"], unsaved["id"]], "action": "pin", "platform_id": platform["id"]},
    )
    results = _results(resp)
    assert results["Bulk Saved"]["ok"] and results["Bulk Saved"]["message"] == "Pinned v1"
    assert not results["Bulk Unsaved"]["ok"] and results["Bulk Unsaved"]["message"] == "No saved version to pin"
    assert [link["emitter_id"] for link in editor_client.get(f"/platforms/{platform['id']}/links").json()] == [saved["id"]]


def test_bulk_release_frees_own_locks_and_skips_the_rest(editor_client, admin_client):
    mine, = _emitters(editor_client, "Bulk Mine", save=False)
    theirs, = _emitters(admin_client, "Bulk Theirs", save=False)
    editor_client.post(f"/emitters/{mine['id']}/checkout")
    admin_client.post(f"/emitters/{theirs['id']}/checkout")
    resp = editor_client.post("/emitters/bulk", json={"emitter_ids": [mine["id"], theirs["id"]], "action": "release"})
    results = _results(resp)
    assert results["Bulk Mine"]["ok"] is True
    assert results["Bulk Theirs"]["ok"] is False  # only the holder or an Admin
    assert editor_client.get(f"/emitters/{mine['id']}").json()["checked_out_by_id"] is None

    # An Admin may release anyone's.
    resp = admin_client.post("/emitters/bulk", json={"emitter_ids": [theirs["id"]], "action": "release"})
    assert _results(resp)["Bulk Theirs"]["ok"] is True
