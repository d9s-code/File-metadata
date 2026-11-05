"""Comparing MDFs: Platforms and Emitters in and out, their versions and
statuses as each side stood, and new, removed and changed Modes."""

from tests.integration.test_mdf_pins_api import _emitter
from tests.integration.test_modes_api import FIXED_LINE


def _setup(client):
    e, ev = _emitter(client, "Compare Emitter")
    p = client.post("/platforms", json={"name": "Compare Platform"}).json()
    client.post(f"/platforms/{p['id']}/links", json={"emitter_id": e["id"], "emitter_version_id": ev["id"]})
    pv = client.post(f"/platforms/{p['id']}/versions", json={"change_summary": "pins"}).json()
    mdf = client.post("/mdfs", json={"name": "Compare MDF"}).json()
    client.post(f"/mdfs/{mdf['id']}/links", json={"platform_id": p["id"], "platform_version_id": pv["id"]})
    client.post(f"/mdfs/{mdf['id']}/versions", json={"change_summary": "first"})
    return mdf, p, e


def test_compare_two_versions_of_an_mdf(editor_client):
    client = editor_client
    mdf, p, e = _setup(client)
    [group] = client.get(f"/emitters/{e['id']}/ew-groups").json()
    [old_mode] = client.get(f"/ew-groups/{group['id']}/modes").json()

    # Between the two versions: a new Mode, a changed one, a new Emitter, and status moves.
    client.post(f"/emitters/{e['id']}/checkout")
    source = client.get(f"/emitters/{e['id']}/sources").json()[0]
    client.post(
        f"/ew-groups/{group['id']}/modes",
        json={"source_id": source["id"], "name": "Track", "pri_type": "fixed", "line": FIXED_LINE},
    )
    client.patch(f"/ew-groups/{group['id']}/modes/{old_mode['id']}", json={"line": {**FIXED_LINE, "rf_max_mhz": FIXED_LINE["rf_max_mhz"] + 50}})
    ev2 = client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v2"}).json()
    e2, ev_new = _emitter(client, "Compare Newcomer")
    for emitter, version in ((e, ev2), (e2, ev_new)):
        client.post(f"/platforms/{p['id']}/links", json={"emitter_id": emitter["id"], "emitter_version_id": version["id"]})
    assert client.post(f"/emitters/{e['id']}/status", json={"new_status": "in_review"}).status_code == 200
    assert client.post(f"/platforms/{p['id']}/status", json={"new_status": "in_review"}).status_code == 200
    pv2 = client.post(f"/platforms/{p['id']}/versions", json={"change_summary": "v2"}).json()
    client.post(f"/mdfs/{mdf['id']}/links", json={"platform_id": p["id"], "platform_version_id": pv2["id"]})
    client.post(f"/mdfs/{mdf['id']}/versions", json={"change_summary": "second"})

    r = client.get("/mdfs/compare", params={"a": mdf["id"], "a_version": 1, "b": mdf["id"], "b_version": 2})
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["a"]["version"], body["b"]["version"]) == (1, 2)

    [platform] = body["platforms"]
    assert platform["change"] == "changed"
    # Repinning the Emitter saved a minor version (v1.1); Save version, the next whole one (v2).
    assert (platform["from_version_label"], platform["to_version_label"]) == ("1", "2")
    assert platform["to_version"] == platform["from_version"] + 2
    assert (platform["from_status"], platform["to_status"], platform["status_changed"]) == ("draft", "in_review", True)
    assert platform["emitters_added"] == ["Compare Newcomer"]

    emitters = {x["name"]: x for x in body["emitters"]}
    moved = emitters["Compare Emitter"]
    assert (moved["from_status"], moved["to_status"], moved["status_changed"]) == ("draft", "in_review", True)
    assert (moved["from_versions"], moved["to_versions"]) == ([1], [2])
    assert (moved["modes_added"], moved["modes_changed"], moved["modes_removed"]) == (1, 1, 0)
    assert emitters["Compare Newcomer"]["change"] == "added"

    modes = {(m["emitter_name"], m["name"]): m for m in body["modes"]}
    assert modes[("Compare Emitter", "Track")]["change"] == "added"
    assert modes[("Compare Emitter", "Track")]["new_emitter"] is False
    assert modes[("Compare Emitter", "M")]["change"] == "changed"
    assert modes[("Compare Emitter", "M")]["fields"] == ["RF"]
    assert modes[("Compare Emitter", "M")]["old_summary"]
    assert modes[("Compare Newcomer", "M")]["new_emitter"] is True
    assert body["counts"]["modes"] == {"added": 2, "removed": 0, "changed": 1}
    assert body["counts"]["emitters"] == {"added": 1, "removed": 0, "status_changed": 1}
    assert body["counts"]["platforms"] == {"added": 0, "removed": 0, "status_changed": 1}

    # v1 against now: statuses are the current ones; with the order swapped, the Newcomer is removed.
    now = client.get("/mdfs/compare", params={"a": mdf["id"], "b": mdf["id"], "b_version": 1}).json()
    assert now["a"]["version"] is None
    assert {x["name"]: x["change"] for x in now["emitters"]}["Compare Newcomer"] == "removed"
    assert [m["change"] for m in now["modes"] if m["name"] == "Track"] == ["removed"]


def test_compare_needs_two_different_sides(editor_client, viewer_client):
    mdf, _, _ = _setup(editor_client)
    same = editor_client.get("/mdfs/compare", params={"a": mdf["id"], "b": mdf["id"], "a_version": 1, "b_version": 1})
    assert same.status_code == 422
    missing = editor_client.get("/mdfs/compare", params={"a": mdf["id"], "b": mdf["id"], "a_version": 9})
    assert missing.status_code == 404
    # Viewers can read a comparison.
    assert viewer_client.get("/mdfs/compare", params={"a": mdf["id"], "b": mdf["id"], "a_version": 1}).status_code == 200


def test_a_platform_new_to_the_mdf_lists_its_emitters(editor_client):
    mdf, _, _ = _setup(editor_client)
    empty = editor_client.post("/mdfs", json={"name": "Compare Empty MDF"}).json()
    body = editor_client.get("/mdfs/compare", params={"a": empty["id"], "b": mdf["id"], "b_version": 1}).json()
    [platform] = body["platforms"]
    assert (platform["change"], platform["emitters_added"], platform["emitters_removed"]) == ("added", ["Compare Emitter"], [])
    swapped = editor_client.get("/mdfs/compare", params={"a": mdf["id"], "a_version": 1, "b": empty["id"]}).json()
    [platform] = swapped["platforms"]
    assert (platform["change"], platform["emitters_added"], platform["emitters_removed"]) == ("removed", [], ["Compare Emitter"])
