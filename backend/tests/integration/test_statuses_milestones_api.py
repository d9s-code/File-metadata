"""Statuses Admins set up (names, colours, order, allowed moves, notes) and
milestones — defaults for every item of a type, an item's own, ticked by
hand — with a status move warning when its milestones aren't met."""


def _last_status_summary(client, entity_type, entity_id):
    """The latest status move's summary in the Audit Log, without the item's name."""
    rows = client.get("/audit-log", params={"entity_type": entity_type, "entity_id": entity_id, "action": "status_change"}).json()["items"]
    return rows[0]["summary"].split(": ", 1)[1]


def _statuses(client, entity_type):
    return [s for s in client.get("/statuses").json() if s["entity_type"] == entity_type]


def _by_key(client, entity_type):
    return {s["key"]: s for s in _statuses(client, entity_type)}


def _saved_emitter(client, name="Milestone Emitter"):
    emitter = client.post("/emitters", json={"name": name}).json()
    client.post(f"/emitters/{emitter['id']}/versions", json={"change_summary": "v1"})
    return emitter


def test_built_in_statuses_for_every_type(viewer_client):
    emitter = _statuses(viewer_client, "emitter")
    assert [s["label"] for s in emitter] == [
        "In progress",
        "Testing",
        "Partially operational",
        "Operational",
        "Needs rework",
    ]
    assert {s["key"]: s["color"] for s in emitter}["in_review"] == "orange"
    assert [s["label"] for s in _statuses(viewer_client, "platform")][0] == "In progress"
    assert [s["key"] for s in _statuses(viewer_client, "mdf")] == [
        "draft",
        "pending_review",
        "approved",
        "released",
        "deprecated",
    ]
    assert all(s["builtin"] for s in emitter)


def test_admin_renames_adds_moves_and_deletes_a_status(admin_client, editor_client):
    testing = _by_key(admin_client, "emitter")["in_review"]
    resp = admin_client.patch(f"/statuses/{testing['id']}", json={"label": "Under test", "color": "purple"})
    assert resp.status_code == 200, resp.text

    emitter = _saved_emitter(admin_client)
    moved = admin_client.post(f"/emitters/{emitter['id']}/status", json={"new_status": "in_review"})
    assert moved.json()["status"] == "in_review"
    assert _last_status_summary(admin_client, "emitter", emitter["id"]) == "Status: In progress → Under test"

    # A new status, reachable from Under test, asking for a note.
    new = admin_client.post("/statuses", json={"entity_type": "emitter", "label": "Field trial", "color": "blue"}).json()
    assert new["key"] == "field_trial" and not new["builtin"]
    admin_client.patch(
        f"/statuses/{testing['id']}", json={"transitions": [*testing["transitions"], "field_trial"]}
    )
    admin_client.patch(
        f"/statuses/{new['id']}",
        json={"transitions": ["in_review"], "requires_note": True, "note_prompt": "Which range?"},
    )
    no_note = admin_client.post(f"/emitters/{emitter['id']}/status", json={"new_status": "field_trial"})
    assert no_note.status_code == 422 and "Which range?" in no_note.json()["detail"]
    ok = admin_client.post(f"/emitters/{emitter['id']}/status", json={"new_status": "field_trial", "note": "North"})
    assert ok.status_code == 200, ok.text
    assert admin_client.get(f"/emitters/{emitter['id']}").json()["status"] == "field_trial"

    # In use: can't delete. Built in: never.
    in_use = admin_client.delete(f"/statuses/{new['id']}")
    assert in_use.status_code == 409 and "move them first" in in_use.json()["detail"]
    assert admin_client.delete(f"/statuses/{testing['id']}").status_code == 409
    admin_client.post(f"/emitters/{emitter['id']}/status", json={"new_status": "in_review"})
    assert admin_client.delete(f"/statuses/{new['id']}").status_code == 204
    assert "field_trial" not in _by_key(admin_client, "emitter")["in_review"]["transitions"]

    # Only Admins.
    assert editor_client.post("/statuses", json={"entity_type": "emitter", "label": "X"}).status_code == 403


def test_reorder_statuses(admin_client):
    ids = [s["id"] for s in _statuses(admin_client, "mdf")]
    resp = admin_client.post("/statuses/reorder", json={"entity_type": "mdf", "ids": list(reversed(ids))})
    assert resp.status_code == 200, resp.text
    assert [s["id"] for s in _statuses(admin_client, "mdf")] == list(reversed(ids))
    bad = admin_client.post("/statuses/reorder", json={"entity_type": "mdf", "ids": ids[:2]})
    assert bad.status_code == 422


def test_milestones_warn_before_a_status_and_are_ticked_by_hand(admin_client, editor_client):
    default = admin_client.post(
        "/milestones/defaults",
        json={"entity_type": "emitter", "status_key": "partially_operational", "title": "Manual dwell test passed"},
    )
    assert default.status_code == 201, default.text
    assert editor_client.post(
        "/milestones/defaults", json={"entity_type": "emitter", "status_key": "validated", "title": "X"}
    ).status_code == 403

    emitter = _saved_emitter(editor_client)
    eid = emitter["id"]
    own = editor_client.post(
        f"/milestones/emitter/{eid}", json={"status_key": "partially_operational", "title": "Search Modes checked"}
    )
    assert own.status_code == 201, own.text
    items = editor_client.get(f"/milestones/emitter/{eid}").json()
    assert [(m["title"], m["is_default"], m["done"]) for m in items] == [
        ("Manual dwell test passed", True, False),
        ("Search Modes checked", False, False),
    ]

    editor_client.post(f"/emitters/{eid}/status", json={"new_status": "in_review"})
    warned = editor_client.post(
        f"/emitters/{eid}/status", json={"new_status": "partially_operational", "note": "Search"}
    )
    assert warned.status_code == 409
    detail = warned.json()["detail"]
    assert detail["unmet_milestones"] == ["Manual dwell test passed", "Search Modes checked"]

    ticked = editor_client.put(
        f"/milestones/{items[0]['id']}/check/{eid}", json={"note": "Passed on the range, 14.10"}
    ).json()
    assert ticked[0]["done"] and ticked[0]["note"] == "Passed on the range, 14.10"
    assert ticked[0]["done_by_username"] == "editor_t"

    # Still one open: confirming goes ahead and records it.
    moved = editor_client.post(
        f"/emitters/{eid}/status",
        json={"new_status": "partially_operational", "note": "Search", "confirm_unmet": True},
    )
    assert moved.status_code == 200, moved.text
    assert _last_status_summary(editor_client, "emitter", emitter["id"]).endswith("(milestones not met: Search Modes checked)")

    # Unticking, and another Emitter's list doesn't carry this one's own.
    after = editor_client.delete(f"/milestones/{items[0]['id']}/check/{eid}").json()
    assert not after[0]["done"]
    other = _saved_emitter(editor_client, "Other Emitter")
    assert [m["title"] for m in editor_client.get(f"/milestones/emitter/{other['id']}").json()] == [
        "Manual dwell test passed"
    ]

    # Defaults are changed by Admins only; an item's own by Editors.
    assert editor_client.delete(f"/milestones/{items[0]['id']}").status_code == 403
    assert editor_client.delete(f"/milestones/{items[1]['id']}").status_code == 204
    assert admin_client.patch(f"/milestones/{items[0]['id']}", json={"title": "Dwell test passed"}).status_code == 200
    assert editor_client.get(f"/milestones/emitter/{other['id']}").json()[0]["title"] == "Dwell test passed"


def test_platform_status_and_milestones(admin_client):
    platform = admin_client.post("/platforms", json={"name": "Milestone Platform"}).json()
    assert platform["status"] == "draft"
    admin_client.post(
        "/milestones/defaults", json={"entity_type": "platform", "status_key": "in_review", "title": "All Emitters pinned"}
    )
    warned = admin_client.post(f"/platforms/{platform['id']}/status", json={"new_status": "in_review"})
    assert warned.status_code == 409
    moved = admin_client.post(
        f"/platforms/{platform['id']}/status", json={"new_status": "in_review", "confirm_unmet": True}
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["status"] == "in_review"
    assert admin_client.post(f"/platforms/{platform['id']}/status", json={"new_status": "deprecated"}).status_code == 409

    # No version for a status move, saved version or not; the Audit Log has it.
    admin_client.post(f"/platforms/{platform['id']}/versions", json={"change_summary": "v1"})
    admin_client.post(f"/platforms/{platform['id']}/status", json={"new_status": "draft"})
    versions = admin_client.get(f"/platforms/{platform['id']}/versions").json()
    assert [v["change_summary"] for v in versions] == ["Initial platform creation", "v1"]
    assert _last_status_summary(admin_client, "platform", platform["id"]) == "Status: Testing → In progress"


def test_mdf_status_uses_its_definitions(admin_client):
    mdf = admin_client.post("/mdfs", json={"name": "Milestone MDF"}).json()
    pending = _by_key(admin_client, "mdf")["pending_review"]
    admin_client.patch(f"/statuses/{pending['id']}", json={"label": "With the customer"})
    resp = admin_client.post(f"/mdfs/{mdf['id']}/status", json={"new_status": "pending_review"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "pending_review"
    assert admin_client.get(f"/mdfs/{mdf['id']}/versions").json() == []
    assert _last_status_summary(admin_client, "mdf", mdf["id"]) == "Status: Draft → With the customer"
