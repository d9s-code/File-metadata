"""An MDF's Platform pins: outdated flags, repinning them all, readiness."""

from tests.integration.test_modes_api import FIXED_LINE


def _emitter(client, name):
    e = client.post("/emitters", json={"name": name}).json()
    g = client.post(f"/emitters/{e['id']}/ew-groups", json={"name": "G"}).json()
    s = client.post(f"/emitters/{e['id']}/sources", json={"name": "S", "source_date": "2025-01-01"}).json()
    client.post(
        f"/ew-groups/{g['id']}/modes",
        json={"source_id": s["id"], "name": "M", "pri_type": "fixed", "line": FIXED_LINE},
    )
    return e, client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"}).json()


def _mdf_with_platform(client, suffix):
    e, ev = _emitter(client, f"Ready Emitter {suffix}")
    p = client.post("/platforms", json={"name": f"Ready Platform {suffix}"}).json()
    client.post(f"/platforms/{p['id']}/links", json={"emitter_id": e["id"], "emitter_version_id": ev["id"]})
    pv = client.post(f"/platforms/{p['id']}/versions", json={"change_summary": "pins"}).json()
    mdf = client.post("/mdfs", json={"name": f"Ready MDF {suffix}"}).json()
    client.post(f"/mdfs/{mdf['id']}/links", json={"platform_id": p["id"], "platform_version_id": pv["id"]})
    return mdf, p, pv, e


def test_mdf_links_flag_an_outdated_platform_pin_and_repin_latest_moves_it(editor_client):
    mdf, p, pv, _ = _mdf_with_platform(editor_client, "A")
    [link] = editor_client.get(f"/mdfs/{mdf['id']}/links").json()
    assert link["pinned_version_number"] == link["latest_version_number"] == pv["version_number"]

    newer = editor_client.post(f"/platforms/{p['id']}/versions", json={"change_summary": "newer"}).json()
    [link] = editor_client.get(f"/mdfs/{mdf['id']}/links").json()
    assert link["latest_version_number"] == newer["version_number"] > link["pinned_version_number"]
    assert link["latest_version_id"] == newer["id"]

    [link] = editor_client.post(f"/mdfs/{mdf['id']}/links/repin-latest").json()
    assert link["platform_version_id"] == newer["id"]
    assert link["pinned_version_number"] == newer["version_number"]


def test_mdf_readiness_lists_each_check(editor_client):
    mdf, p, _, e = _mdf_with_platform(editor_client, "B")
    checks = {c["key"]: c for c in editor_client.get(f"/mdfs/{mdf['id']}/readiness").json()}
    assert list(checks) == [
        "pinned",
        "saved",
        "platform_pins",
        "emitter_pins",
        "operational",
        "simulation",
        "ambiguity",
        "mdf_test",
    ]
    assert checks["pinned"]["status"] == "ok"
    assert checks["saved"]["status"] == "fail"  # never saved
    assert checks["operational"]["status"] == "fail" and checks["operational"]["items"] == [
        "Ready Emitter B: In progress"
    ]
    assert checks["simulation"]["status"] == "warn"  # never simulation-tested
    assert checks["ambiguity"]["status"] == "warn"  # never checked

    # A newer Emitter version than the one the pinned Platform version holds.
    editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "newer"})
    editor_client.post(f"/mdfs/{mdf['id']}/versions", json={"change_summary": "first"})
    checks = {c["key"]: c for c in editor_client.get(f"/mdfs/{mdf['id']}/readiness").json()}
    assert checks["saved"]["status"] == "ok"
    assert checks["emitter_pins"]["status"] == "warn"
    assert checks["emitter_pins"]["items"] == ["Ready Platform B → Ready Emitter B: v1 pinned, v2 saved"]
