FIXED_LINE = {
    "rf_min_mhz": 2900,
    "rf_max_mhz": 3100,
    "pw_min_us": 0.5,
    "pw_max_us": 1.2,
    "pri_min_us": 800,
    "pri_max_us": 1200,
    "jitter_min_us": 5,
    "jitter_max_us": 15,
    "rf_delta": 1,
    "pw_delta": 0.05,
    "pri_delta": 10,
    "rf_range_matching": False,
    "pw_range_matching": False,
    "pri_range_matching": False,
}


def _setup_source_emitter(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Fork Source Emitter"}).json()
    ew_group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Group F"}).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Source F", "source_date": "2025-01-01"}
    ).json()
    mode = editor_client.post(
        f"/ew-groups/{ew_group['id']}/modes",
        json={"source_id": source["id"], "name": "Mode F", "pri_type": "fixed", "line": FIXED_LINE},
    ).json()
    version = editor_client.post(f"/emitters/{emitter['id']}/versions", json={"change_summary": "v1"}).json()
    return {"emitter": emitter, "ew_group": ew_group, "source": source, "mode": mode, "version": version}


def test_fork_creates_independent_emitter_with_fresh_ids(editor_client):
    ctx = _setup_source_emitter(editor_client)
    emitter_id = ctx["emitter"]["id"]

    resp = editor_client.post(
        f"/emitters/{emitter_id}/versions/1/fork", json={"new_name": "Forked Emitter"}
    )
    assert resp.status_code == 201, resp.text
    forked = resp.json()
    assert forked["id"] != emitter_id
    assert forked["name"] == "Forked Emitter"
    assert forked["status"] == "draft"
    assert forked["forked_from_emitter_id"] == emitter_id
    assert forked["forked_from_version_id"] == ctx["version"]["id"]
    assert forked["checked_out_by_id"] is not None

    forked_modes = editor_client.get(f"/emitters/{forked['id']}/modes").json()
    assert len(forked_modes) == 1
    assert forked_modes[0]["id"] != ctx["mode"]["id"]
    assert forked_modes[0]["name"] == "Mode F"

    # The forked Emitter's history isn't blank: version 1 is copied in
    # verbatim from the source (same version_number/summary), and the fork
    # itself becomes version 2 — a continuous lineage, not a fresh start.
    assert forked["forked_at_version_number"] == 1
    forked_versions = editor_client.get(f"/emitters/{forked['id']}/versions").json()
    assert len(forked_versions) == 2
    assert forked_versions[0]["version_number"] == 1
    assert forked_versions[0]["change_summary"] == "v1"
    assert forked_versions[1]["version_number"] == 2
    assert "Forked from" in forked_versions[1]["change_summary"]


def test_fork_does_not_require_source_emitter_checkout(editor_client, admin_client):
    ctx = _setup_source_emitter(editor_client)
    emitter_id = ctx["emitter"]["id"]
    # editor_client still holds the source emitter's checkout; admin doesn't
    # need it to fork.
    resp = admin_client.post(
        f"/emitters/{emitter_id}/versions/1/fork", json={"new_name": "Admin Forked Emitter"}
    )
    assert resp.status_code == 201, resp.text


def test_fork_editing_does_not_affect_source_emitter(editor_client):
    ctx = _setup_source_emitter(editor_client)
    emitter_id = ctx["emitter"]["id"]
    forked = editor_client.post(
        f"/emitters/{emitter_id}/versions/1/fork", json={"new_name": "Divergent Fork"}
    ).json()

    forked_mode = editor_client.get(f"/emitters/{forked['id']}/modes").json()[0]
    editor_client.patch(
        f"/ew-groups/{forked_mode['ew_group_id']}/modes/{forked_mode['id']}", json={"notes": "diverged"}
    )

    original_mode = editor_client.get(f"/emitters/{emitter_id}/modes").json()[0]
    assert original_mode["notes"] is None


def test_fork_missing_version_is_404(editor_client):
    ctx = _setup_source_emitter(editor_client)
    resp = editor_client.post(
        f"/emitters/{ctx['emitter']['id']}/versions/99/fork", json={"new_name": "Nonexistent Fork"}
    )
    assert resp.status_code == 404


def test_fork_duplicate_name_is_409(editor_client):
    ctx = _setup_source_emitter(editor_client)
    resp = editor_client.post(
        f"/emitters/{ctx['emitter']['id']}/versions/1/fork", json={"new_name": ctx["emitter"]["name"]}
    )
    assert resp.status_code == 409
