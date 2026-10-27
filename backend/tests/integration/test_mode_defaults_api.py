"""The admin's Mode defaults: a new Mode's confirmation where it isn't given
one, and a stagger's frame-time margin (3 µs out of the box) where Modes are
made without a form."""

from tests.integration.test_ambiguity_api import FIXED_LINE


def _setup(client):
    emitter = client.post("/emitters", json={"name": "Defaults Emitter"}).json()
    group = client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Group"}).json()
    source = client.post(f"/emitters/{emitter['id']}/sources", json={"name": "Src", "source_date": "2026-01-01"}).json()
    return emitter, group, source


def test_the_defaults_out_of_the_box_and_only_an_admin_changes_them(admin_client, editor_client):
    defaults = editor_client.get("/settings").json()["mode_defaults"]
    assert defaults == {"confirmation_quality": 100, "confirmation_quantity": 2, "frame_time_delta_us": 3.0,
                        "rf_delta": 0.0, "pri_delta": 0.0, "pw_delta": 0.0}
    changed = {**defaults, "confirmation_quality": 80, "frame_time_delta_us": 5}
    assert editor_client.patch("/settings", json={"mode_defaults": changed}).status_code == 403
    assert admin_client.patch("/settings", json={"mode_defaults": {**changed, "confirmation_quality": 101}}).status_code == 422
    resp = admin_client.patch("/settings", json={"mode_defaults": changed})
    assert resp.status_code == 200, resp.text
    assert resp.json()["mode_defaults"]["frame_time_delta_us"] == 5
    log = admin_client.get("/audit-log", params={"limit": 20}).json()
    summaries = [e["summary"] for e in (log["items"] if isinstance(log, dict) else log)]
    assert "Changed the Mode defaults: confirmation quality 100% → 80%, frame-time delta 3 µs → 5 µs" in summaries


def test_new_modes_get_the_defaults_where_not_given(admin_client, editor_client):
    defaults = editor_client.get("/settings").json()["mode_defaults"]
    admin_client.patch(
        "/settings", json={"mode_defaults": {**defaults, "confirmation_quality": 70, "confirmation_quantity": 4}}
    )
    emitter, group, source = _setup(editor_client)
    modes = f"/ew-groups/{group['id']}/modes"
    plain = editor_client.post(modes, json={"source_id": source["id"], "name": "A", "pri_type": "fixed", "line": FIXED_LINE}).json()
    assert (plain["confirmation_quality"], plain["confirmation_quantity"]) == (70, 4)
    given = editor_client.post(
        modes,
        json={"source_id": source["id"], "name": "B", "pri_type": "fixed", "line": FIXED_LINE, "confirmation_quality": 100},
    ).json()
    assert (given["confirmation_quality"], given["confirmation_quantity"]) == (100, 4)

    # A typed stagger line has no frame-time margin: it gets the default, on the frame time only.
    typed = editor_client.post(
        f"{modes}/from-dsl", json={"source_id": source["id"], "name": "C", "dsl_text": "RF 9400-9600 PRI STAGGER [500, 520, 540] PW 1-1"}
    )
    assert typed.status_code == 201, typed.text
    line = typed.json()["line"]
    assert line["frame_time_delta_us"] == 3 and line["pri_delta"] is None
    assert typed.json()["confirmation_quality"] == 70
