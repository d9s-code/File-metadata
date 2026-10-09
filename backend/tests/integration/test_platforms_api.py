import pytest


@pytest.fixture()
def emitter_with_version(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Pinned Emitter"}).json()
    v1 = editor_client.post(f"/emitters/{emitter['id']}/versions", json={"change_summary": "test"}).json()
    return {"emitter": emitter, "version": v1}


def test_create_platform(editor_client):
    resp = editor_client.post("/platforms", json={"name": "Platform A", "description": "A ship"})
    assert resp.status_code == 201, resp.text
    assert resp.json()["name"] == "Platform A"


def test_duplicate_platform_name_rejected(editor_client):
    editor_client.post("/platforms", json={"name": "Dup Platform"})
    resp = editor_client.post("/platforms", json={"name": "Dup Platform"})
    assert resp.status_code == 409


def test_pin_requires_a_committed_emitter_version(editor_client):
    platform = editor_client.post("/platforms", json={"name": "No Commit Platform"}).json()
    emitter = editor_client.post("/emitters", json={"name": "Uncommitted Emitter"}).json()
    # Never committed a version, so no emitter_versions row exists to reference.
    import uuid

    fake_version_id = str(uuid.uuid4())
    resp = editor_client.post(
        f"/platforms/{platform['id']}/links",
        json={"emitter_id": emitter["id"], "emitter_version_id": fake_version_id},
    )
    assert resp.status_code == 422


def test_pin_and_repin_emitter_version(editor_client, emitter_with_version):
    platform = editor_client.post("/platforms", json={"name": "Pin Platform"}).json()
    emitter = emitter_with_version["emitter"]
    v1 = emitter_with_version["version"]

    resp = editor_client.post(
        f"/platforms/{platform['id']}/links",
        json={"emitter_id": emitter["id"], "emitter_version_id": v1["id"]},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["emitter_version_id"] == v1["id"]

    # Commit a second emitter version, then repin to it.
    v2 = editor_client.post(f"/emitters/{emitter['id']}/versions", json={"change_summary": "test"}).json()
    resp = editor_client.post(
        f"/platforms/{platform['id']}/links",
        json={"emitter_id": emitter["id"], "emitter_version_id": v2["id"]},
    )
    assert resp.status_code == 201
    assert resp.json()["emitter_version_id"] == v2["id"]

    links = editor_client.get(f"/platforms/{platform['id']}/links").json()
    assert len(links) == 1  # repin updates the existing link, doesn't duplicate
    assert links[0]["emitter_version_id"] == v2["id"]


def test_platform_pinning_survives_new_emitter_version(editor_client, emitter_with_version):
    """Pin to emitter v1, then commit emitter v2 — the platform link stays on
    v1 until an explicit repin action.
    """
    platform = editor_client.post("/platforms", json={"name": "Stable Pin Platform"}).json()
    emitter = emitter_with_version["emitter"]
    v1 = emitter_with_version["version"]
    editor_client.post(
        f"/platforms/{platform['id']}/links", json={"emitter_id": emitter["id"], "emitter_version_id": v1["id"]}
    )

    editor_client.patch(f"/emitters/{emitter['id']}", json={"description": "changed after pin"})
    editor_client.post(f"/emitters/{emitter['id']}/versions", json={"change_summary": "test"})  # v2, unrelated to the pin

    links = editor_client.get(f"/platforms/{platform['id']}/links").json()
    assert links[0]["emitter_version_id"] == v1["id"]


def test_platform_version_commit_and_diff(editor_client, emitter_with_version):
    # POST /platforms already auto-commits an initial version (v1, no links) —
    # see "Automatically commit the initial version" in create_platform. No
    # need to commit again before adding the link.
    platform = editor_client.post("/platforms", json={"name": "Versioned Platform"}).json()
    emitter = emitter_with_version["emitter"]
    v1 = emitter_with_version["version"]

    editor_client.post(
        f"/platforms/{platform['id']}/links", json={"emitter_id": emitter["id"], "emitter_version_id": v1["id"]}
    )
    editor_client.post(f"/platforms/{platform['id']}/versions", json={})  # platform v2, one link

    diff = editor_client.get(f"/platforms/{platform['id']}/versions/2/diff").json()
    assert len(diff["added"]) == 1
    assert diff["added"][0]["value"]["emitter_id"] == emitter["id"]
    # And readably: the pin, by name and version — not the pinned Emitter's whole snapshot.
    assert diff["entries"] == [
        {
            "scope": f"Emitter '{emitter['name']}'",
            "label": "Pinned",
            "kind": "added",
            "old_value": None,
            "new_value": f"At its v{v1['version_number']}",
        }
    ]


def test_unpin_removes_link(editor_client, emitter_with_version):
    platform = editor_client.post("/platforms", json={"name": "Unpin Platform"}).json()
    emitter = emitter_with_version["emitter"]
    v1 = emitter_with_version["version"]
    editor_client.post(
        f"/platforms/{platform['id']}/links", json={"emitter_id": emitter["id"], "emitter_version_id": v1["id"]}
    )
    resp = editor_client.delete(f"/platforms/{platform['id']}/links/{emitter['id']}")
    assert resp.status_code == 204
    assert editor_client.get(f"/platforms/{platform['id']}/links").json() == []


def test_coverage_lists_each_pinned_emitter_versions_modes(editor_client):
    from tests.integration.test_modes_api import FIXED_LINE

    emitter = editor_client.post("/emitters", json={"name": "Coverage Emitter", "designation": "CV-1"}).json()
    group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Search"}).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Report", "source_date": "2025-01-01"}
    ).json()
    editor_client.post(
        f"/ew-groups/{group['id']}/modes",
        json={"source_id": source["id"], "name": "S1", "pri_type": "fixed", "line": FIXED_LINE},
    )
    version = editor_client.post(f"/emitters/{emitter['id']}/versions", json={"change_summary": "v1"}).json()
    platform = editor_client.post("/platforms", json={"name": "Coverage Platform"}).json()
    editor_client.post(
        f"/platforms/{platform['id']}/links", json={"emitter_id": emitter["id"], "emitter_version_id": version["id"]}
    )
    # A Mode added after the pinned version doesn't show.
    editor_client.post(
        f"/ew-groups/{group['id']}/modes",
        json={"source_id": source["id"], "name": "Later", "pri_type": "fixed", "line": FIXED_LINE},
    )

    resp = editor_client.get(f"/platforms/{platform['id']}/coverage")
    assert resp.status_code == 200, resp.text
    [entry] = resp.json()
    assert (entry["designation"], entry["emitter_name"], entry["version_number"]) == ("CV-1", "Coverage Emitter", 1)
    [mode] = entry["modes"]
    assert mode["name"] == "S1" and mode["rf_raw"] == [2900.0, 3100.0]
    # The engineered ranges carry each parameter's ± delta.
    assert mode["rf"] == [2899.0, 3101.0] and mode["pri"] == [790.0, 1210.0]



def test_mdf_coverage_groups_emitters_under_their_pinned_platform_version(editor_client):
    from tests.integration.test_modes_api import FIXED_LINE

    emitter = editor_client.post("/emitters", json={"name": "MDF Cov Emitter", "designation": "MC-1"}).json()
    group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Search"}).json()
    source = editor_client.post(
        f"/emitters/{emitter['id']}/sources", json={"name": "Report", "source_date": "2025-01-01"}
    ).json()
    editor_client.post(
        f"/ew-groups/{group['id']}/modes",
        json={"source_id": source["id"], "name": "S1", "pri_type": "fixed", "line": FIXED_LINE},
    )
    ev = editor_client.post(f"/emitters/{emitter['id']}/versions", json={"change_summary": "v1"}).json()
    platform = editor_client.post("/platforms", json={"name": "MDF Cov Platform"}).json()
    editor_client.post(f"/platforms/{platform['id']}/links", json={"emitter_id": emitter["id"], "emitter_version_id": ev["id"]})
    pv = editor_client.post(f"/platforms/{platform['id']}/versions", json={"change_summary": "p1"}).json()
    mdf = editor_client.post("/mdfs", json={"name": "MDF Cov"}).json()
    resp = editor_client.post(
        f"/mdfs/{mdf['id']}/links", json={"platform_id": platform["id"], "platform_version_id": pv["id"]}
    )
    assert resp.status_code == 201, resp.text

    resp = editor_client.get(f"/mdfs/{mdf['id']}/coverage")
    assert resp.status_code == 200, resp.text
    [plat] = resp.json()
    assert (plat["platform_name"], plat["version_number"]) == ("MDF Cov Platform", pv["version_number"])
    [em] = plat["emitters"]
    assert (em["designation"], em["emitter_name"], em["version_number"]) == ("MC-1", "MDF Cov Emitter", 1)
    assert [m["name"] for m in em["modes"]] == ["S1"] and em["modes"][0]["rf"] == [2899.0, 3101.0]
