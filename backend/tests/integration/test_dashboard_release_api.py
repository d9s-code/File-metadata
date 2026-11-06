"""The dashboard's current release: the MDF an admin pinned (else the most
recently changed one not released), its Emitters, its changelog;
and the Health counts."""

from tests.integration.test_mdf_plan_api import _setup


def test_no_mdf_no_release(editor_client):
    out = editor_client.get("/dashboard/release").json()
    assert out == {"mdf": None, "pinned": False, "emitters": [], "changes": None}


def test_the_latest_unreleased_mdf_until_an_admin_pins_one(admin_client, editor_client):
    emitter, platform, first = _setup(editor_client, "Release One")
    _e2, _p2, second = _setup(editor_client, "Release Two")

    out = editor_client.get("/dashboard/release").json()
    assert (out["mdf"]["name"], out["pinned"]) == ("Release Two", False)
    [row] = out["emitters"]
    assert row["name"] == "Release Two Radar" and row["platforms"] == ["Release Two Ship"]
    assert row["pinned_version"] == row["latest_version"] == 1
    assert row["sim"]["line_count"] == 0 and row["assignee"] is None
    # The changelog: everything, as nothing was released before.
    assert out["changes"]["since"] == "the start" and out["changes"]["to_version"] == 1
    assert [a["name"] for a in out["changes"]["change_notes"]["added"]] == ["Release Two Ship", "Release Two Radar"]

    assert editor_client.put("/dashboard/current-mdf", json={"mdf_id": first["id"]}).status_code == 403
    assert admin_client.put("/dashboard/current-mdf", json={"mdf_id": "00000000-0000-0000-0000-000000000000"}).status_code == 404
    pinned = admin_client.put("/dashboard/current-mdf", json={"mdf_id": first["id"]}).json()
    assert (pinned["mdf"]["name"], pinned["pinned"]) == ("Release One", True)
    assert editor_client.get("/dashboard/release").json()["mdf"]["name"] == "Release One"

    unpinned = admin_client.put("/dashboard/current-mdf", json={"mdf_id": None}).json()
    assert (unpinned["mdf"]["name"], unpinned["pinned"]) == ("Release Two", False)
    log = admin_client.get("/audit-log", params={"limit": 20}).json()
    summaries = [e["summary"] for e in (log["items"] if isinstance(log, dict) else log)]
    assert "Pinned MDF 'Release One' to the dashboard" in summaries and "Unpinned the dashboard's MDF" in summaries


def test_a_released_mdf_is_left_for_the_next_one(admin_client, editor_client):
    _e, _p, old = _setup(editor_client, "Old Release")
    for s in ("pending_review", "approved", "released"):
        assert editor_client.post(f"/mdfs/{old['id']}/status", json={"new_status": s, "confirm_unmet": True}).status_code == 200
    assert editor_client.get("/dashboard/release").json()["mdf"] is None
    # Pinned, it stays — even once released.
    admin_client.put("/dashboard/current-mdf", json={"mdf_id": old["id"]})
    assert editor_client.get("/dashboard/release").json()["mdf"]["status"] == "released"


def test_health_counts(admin_client, editor_client):
    keys = {"ambiguity", "intercepts", "held_for_editing", "dwell_testing", "failed_logins_24h"}
    mine = editor_client.get("/dashboard/health").json()
    assert set(mine) == keys and mine["failed_logins_24h"] is None
    assert isinstance(admin_client.get("/dashboard/health").json()["failed_logins_24h"], int)
