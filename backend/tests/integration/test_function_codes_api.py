"""Function codes: an Admin-kept list of what kind of emitter an Emitter is,
set when an Emitter is made, changed without the edit lock, copied by a
duplicate, and grouped by in the threat priority overview."""

import uuid


def _code(client, code, name):
    resp = client.post("/function-codes", json={"code": code, "name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_only_admins_keep_the_list(admin_client, editor_client):
    assert editor_client.post("/function-codes", json={"code": "FC", "name": "Fire control"}).status_code == 403
    fc = _code(admin_client, "FC", "Fire control")
    sr = _code(admin_client, "SR", "Search")
    assert sr["sort_order"] > fc["sort_order"]
    assert admin_client.post("/function-codes", json={"code": "fc", "name": "Again"}).status_code == 409
    assert [c["code"] for c in editor_client.get("/function-codes").json()][:2] == ["FC", "SR"]
    resp = admin_client.patch(f"/function-codes/{fc['id']}", json={"name": "Fire control radar", "sort_order": 9})
    assert resp.json()["name"] == "Fire control radar"
    assert editor_client.patch(f"/function-codes/{fc['id']}", json={"name": "X"}).status_code == 403
    audit = admin_client.get("/audit-log", params={"entity_type": "function_code"}).json()["items"]
    assert any(a["summary"].startswith("Added function code 'FC'") for a in audit)


def test_an_emitter_gets_one_and_keeps_it_through_a_duplicate(admin_client, editor_client):
    fc = _code(admin_client, "FC2", "Fire control")
    nav = _code(admin_client, "NAV2", "Navigation")
    e = editor_client.post("/emitters", json={"name": "FC Radar", "function_code_id": fc["id"]}).json()
    assert e["function_code_id"] == fc["id"]
    bad = editor_client.post("/emitters", json={"name": "Bad code", "function_code_id": str(uuid.uuid4())})
    assert bad.status_code == 422

    # Changed without the edit lock, and audited.
    editor_client.delete(f"/emitters/{e['id']}/checkout")
    resp = editor_client.put(f"/emitters/{e['id']}/function-code", json={"function_code_id": nav["id"]})
    assert resp.status_code == 200, resp.text
    assert resp.json()["function_code_id"] == nav["id"]
    audit = editor_client.get("/audit-log", params={"emitter_id": e["id"]}).json()["items"]
    assert any("function code to NAV2" in a["summary"] for a in audit)

    copy = editor_client.post(f"/emitters/{e['id']}/duplicate", json={"new_name": "FC Radar copy"}).json()
    assert copy["function_code_id"] == nav["id"]

    rows = [r for r in editor_client.get("/threat-priorities").json() if r["emitter_id"] == e["id"]]
    assert all(r["function_code_id"] == nav["id"] for r in rows)


def test_one_in_use_is_deleted_only_by_moving_its_emitters(admin_client, editor_client):
    old = _code(admin_client, "OLD", "Old kind")
    new = _code(admin_client, "NEW", "New kind")
    e = editor_client.post("/emitters", json={"name": "Old kind radar", "function_code_id": old["id"]}).json()
    listed = {c["id"]: c for c in admin_client.get("/function-codes").json()}
    assert listed[old["id"]]["emitter_count"] == 1
    resp = admin_client.delete(f"/function-codes/{old['id']}")
    assert resp.status_code == 409
    assert admin_client.delete(f"/function-codes/{old['id']}?move_to={new['id']}").status_code == 204
    assert editor_client.get(f"/emitters/{e['id']}").json()["function_code_id"] == new["id"]
    unused = _code(admin_client, "UNUSED", "Nobody")
    assert admin_client.delete(f"/function-codes/{unused['id']}").status_code == 204
