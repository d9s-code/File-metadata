from datetime import date


def _people(client):
    return {p["username"]: p["id"] for p in client.get("/people").json()}


def test_people_lists_active_users_for_anyone(admin_client, editor_client, viewer_client):
    people = viewer_client.get("/people").json()
    assert {p["username"] for p in people} >= {"admin_t", "editor_t", "viewer_t"}
    viewer_id = _people(admin_client)["viewer_t"]
    admin_client.patch(f"/users/{viewer_id}", json={"is_active": False})
    assert "viewer_t" not in _people(admin_client)


def test_assign_emitter_needs_no_edit_lock_and_is_audited(admin_client, editor_client, viewer_client):
    emitter = admin_client.post("/emitters", json={"name": "Assign Radar"}).json()
    admin_client.post(f"/emitters/{emitter['id']}/versions", json={"change_summary": "v1"})  # also ends the edit
    people = _people(admin_client)

    resp = editor_client.put(f"/emitters/{emitter['id']}/assignee", json={"assignee_id": people["editor_t"]})
    assert resp.status_code == 200, resp.text
    assert resp.json()["assignee_username"] == "editor_t"
    listed = {e["id"]: e for e in viewer_client.get("/emitters").json()}
    assert listed[emitter["id"]]["assignee_username"] == "editor_t"

    # Viewers can't edit, so can't be given an Emitter; nor can they assign one.
    assert editor_client.put(f"/emitters/{emitter['id']}/assignee", json={"assignee_id": people["viewer_t"]}).status_code == 422
    assert viewer_client.put(f"/emitters/{emitter['id']}/assignee", json={"assignee_id": None}).status_code == 403

    assert editor_client.put(f"/emitters/{emitter['id']}/assignee", json={"assignee_id": None}).json()["assignee_id"] is None
    summaries = [a["summary"] for a in admin_client.get("/audit-log", params={"entity_type": "emitter"}).json()["items"]]
    assert "Assigned Emitter 'Assign Radar' to editor_t" in summaries and "Unassigned Emitter 'Assign Radar'" in summaries

    # Not part of what a version saves: assigning leaves nothing unsaved.
    editor_client.put(f"/emitters/{emitter['id']}/assignee", json={"assignee_id": people["admin_t"]})
    assert admin_client.get(f"/emitters/{emitter['id']}/diff/live").json()["identical"]


def test_task_lifecycle_and_views(admin_client, editor_client, viewer_client):
    people = _people(admin_client)
    emitter = admin_client.post("/emitters", json={"name": "Task Radar"}).json()

    mine = editor_client.post("/tasks", json={"title": "  Check my notes  "}).json()
    assert mine["title"] == "Check my notes" and mine["assignee_id"] is None and mine["created_by_username"] == "editor_t"

    given = editor_client.post(
        "/tasks",
        json={
            "title": "Review the new Modes",
            "assignee_id": people["admin_t"],
            "due_date": "2026-10-10",
            "entity_type": "emitter",
            "entity_id": emitter["id"],
        },
    )
    assert given.status_code == 201, given.text
    given = given.json()
    assert (given["assignee_username"], given["entity_name"]) == ("admin_t", "Task Radar")

    assert [t["title"] for t in admin_client.get("/tasks", params={"assignee": "me"}).json()] == ["Review the new Modes"]
    assert [t["title"] for t in admin_client.get("/tasks", params={"assignee": "none"}).json()] == ["Check my notes"]
    about = viewer_client.get("/tasks", params={"entity_type": "emitter", "entity_id": emitter["id"]}).json()
    assert [t["id"] for t in about] == [given["id"]]

    work = admin_client.get("/tasks/my-work").json()
    assert [t["title"] for t in work["tasks"]] == ["Review the new Modes"] and work["unassigned_open"] == 1

    # Take the unassigned one, then finish it.
    took = admin_client.patch(f"/tasks/{mine['id']}", json={"assignee_id": people["admin_t"]}).json()
    assert took["assignee_username"] == "admin_t"
    done = admin_client.patch(f"/tasks/{mine['id']}", json={"done": True}).json()
    assert done["done_at"] and done["done_by_username"] == "admin_t"
    assert [t["title"] for t in admin_client.get("/tasks", params={"state": "done"}).json()] == ["Check my notes"]
    assert admin_client.patch(f"/tasks/{mine['id']}", json={"done": False}).json()["done_at"] is None

    # Clearing a field with null; leaving others alone.
    cleared = editor_client.patch(f"/tasks/{given['id']}", json={"due_date": None}).json()
    assert cleared["due_date"] is None and cleared["assignee_username"] == "admin_t"

    summaries = [a["summary"] for a in admin_client.get("/audit-log", params={"entity_type": "task"}).json()["items"]]
    assert "Created task 'Review the new Modes' for admin_t" in summaries
    assert "Completed task 'Check my notes'" in summaries and "Reopened task 'Check my notes'" in summaries


def test_task_permissions(admin_client, editor_client, viewer_client):
    people = _people(admin_client)
    for_viewer = admin_client.post("/tasks", json={"title": "Read the brief", "assignee_id": people["viewer_t"]}).json()
    other = admin_client.post("/tasks", json={"title": "Admin's own", "assignee_id": people["admin_t"]}).json()

    assert viewer_client.post("/tasks", json={"title": "x"}).status_code == 403
    # A viewer can tick off their own task, and nothing more.
    assert viewer_client.patch(f"/tasks/{for_viewer['id']}", json={"done": True}).status_code == 200
    assert viewer_client.patch(f"/tasks/{for_viewer['id']}", json={"title": "Renamed"}).status_code == 403
    assert viewer_client.patch(f"/tasks/{other['id']}", json={"done": True}).status_code == 403
    # Deleting: whoever made it, whoever it's for, or an admin.
    assert editor_client.delete(f"/tasks/{other['id']}").status_code == 403
    assert admin_client.delete(f"/tasks/{other['id']}").status_code == 204
    assert admin_client.post("/tasks", json={"title": "   "}).status_code == 422


def test_task_links_check_the_item(admin_client):
    assert admin_client.post(
        "/tasks", json={"title": "x", "entity_type": "platform", "entity_id": "00000000-0000-0000-0000-000000000000"}
    ).status_code == 404
    assert admin_client.post("/tasks", json={"title": "x", "entity_type": "platform"}).status_code == 422
    platform = admin_client.post("/platforms", json={"name": "Task Platform"}).json()
    task = admin_client.post("/tasks", json={"title": "Pin it", "entity_type": "platform", "entity_id": platform["id"]}).json()
    admin_client.delete(f"/platforms/{platform['id']}")
    [listed] = admin_client.get("/tasks").json()
    assert listed["id"] == task["id"] and listed["entity_deleted"] is True and listed["entity_name"] == "Task Platform"


def test_my_work_lists_assigned_emitters(admin_client):
    people = _people(admin_client)
    emitter = admin_client.post("/emitters", json={"name": "Mine Radar"}).json()
    admin_client.put(f"/emitters/{emitter['id']}/assignee", json={"assignee_id": people["admin_t"]})
    admin_client.post("/tasks", json={"title": "t", "entity_type": "emitter", "entity_id": emitter["id"]})
    [e] = admin_client.get("/tasks/my-work").json()["emitters"]
    assert (e["name"], e["checked_out_by_username"], e["open_tasks"]) == ("Mine Radar", "admin_t", 1)
    assert date.today()  # sanity


def test_task_notes_log(admin_client, editor_client, viewer_client):
    people = _people(admin_client)
    task = admin_client.post("/tasks", json={"title": "Narrow the Modes", "assignee_id": people["viewer_t"]}).json()
    assert task["note_count"] == 0

    first = editor_client.post(f"/tasks/{task['id']}/notes", json={"body": "  Waiting on the new intercepts  "})
    assert first.status_code == 201, first.text
    assert first.json()["body"] == "Waiting on the new intercepts" and first.json()["author_username"] == "editor_t"
    # Whoever it's for can add notes too, even a viewer.
    assert viewer_client.post(f"/tasks/{task['id']}/notes", json={"body": "Got them, starting"}).status_code == 201
    assert viewer_client.post(f"/tasks/{task['id']}/notes", json={"body": "   "}).status_code == 422

    notes = viewer_client.get(f"/tasks/{task['id']}/notes").json()
    assert [n["body"] for n in notes] == ["Got them, starting", "Waiting on the new intercepts"]
    assert admin_client.get("/tasks", params={"assignee": people["viewer_t"]}).json()[0]["note_count"] == 2

    # Someone else's task: a viewer can't add to it.
    other = admin_client.post("/tasks", json={"title": "Other"}).json()
    assert viewer_client.post(f"/tasks/{other['id']}/notes", json={"body": "x"}).status_code == 403

    # Only the author, or an admin, deletes a note.
    editor_note = notes[1]["id"]
    assert viewer_client.delete(f"/tasks/{task['id']}/notes/{editor_note}").status_code == 403
    assert editor_client.delete(f"/tasks/{task['id']}/notes/{editor_note}").status_code == 204
    assert admin_client.delete(f"/tasks/{task['id']}/notes/{notes[0]['id']}").status_code == 204
    assert viewer_client.get(f"/tasks/{task['id']}/notes").json() == []

    summaries = [a["summary"] for a in admin_client.get("/audit-log", params={"entity_type": "task"}).json()["items"]]
    assert "Added a note to task 'Narrow the Modes'" in summaries and "Deleted a note from task 'Narrow the Modes'" in summaries

    # Deleting the task takes its notes with it.
    admin_client.post(f"/tasks/{other['id']}/notes", json={"body": "gone soon"})
    assert admin_client.delete(f"/tasks/{other['id']}").status_code == 204
    assert admin_client.get(f"/tasks/{other['id']}/notes").status_code == 404
