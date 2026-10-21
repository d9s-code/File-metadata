"""Dwells: Strategies (a Platform's dwell, named, versioned) pinned into dwell
files (versioned, any Strategies), imported from and written as
XML (MHz and ms, as in the file); the charts' default bandwidth; an MDF's
export carrying its dwell files; test runs recording the Strategy used."""

import io
import zipfile

from lxml import etree

EXAMPLE = b"""<?xml version="1.0" encoding="utf-8"?>
<DwellStrategies>
    <Settings timeout="5" setup_time="5" />
    <Strategy manual_collect_time="50">
        <RapidDF collect_time="50" dwell_time="50" freq="500" />
        <MergedMode>
            <Dwell collect_time="50" dwell_time="50"><Freq value="4000" /></Dwell>
            <Dwell collect_time="50" dwell_time="50"><Freq value="2000" /></Dwell>
            <Dwell collect_time="50" dwell_time="50"><Freq value="3000" /></Dwell>
        </MergedMode>
        <SplitMode>
            <Dwell collect_time="50" dwell_time="50">
                <Freq value="500" />
                <Freq value="750" />
            </Dwell>
        </SplitMode>
    </Strategy>
    <Strategy manual_collect_time="50">
        <RapidDF collect_time="50" dwell_time="50" freq="500" />
        <MergedMode>
            <Dwell collect_time="50" dwell_time="50"><Freq value="9000" /></Dwell>
            <Dwell collect_time="50" dwell_time="50"><Freq value="8000" /></Dwell>
        </MergedMode>
        <SplitMode>
            <Dwell collect_time="50" dwell_time="50">
                <Freq value="500" />
                <Freq value="750" />
            </Dwell>
        </SplitMode>
    </Strategy>
</DwellStrategies>
"""


def _import(client, content=EXAMPLE, name="Northern dwells"):
    return client.post(
        "/dwell-files/import", files={"file": ("north.xml", content, "application/xml")}, data={"name": name}
    )


def _canonical(xml: bytes) -> bytes:
    return etree.tostring(etree.fromstring(xml, etree.XMLParser(remove_blank_text=True)), method="c14n")


def _platform(client, name):
    return client.post("/platforms", json={"name": name}).json()


def test_import_makes_a_strategy_each_and_writes_the_same_file(editor_client):
    resp = _import(editor_client)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["latest_version_number"] == 1 and body["unsaved"] is False
    first, second = body["links"]
    assert first["strategy_name"] == "Northern dwells — Strategy 1" and first["platform_ids"] == [] and first["is_default"]
    # MHz, as the file has them.
    assert [d["freq_mhz"] for d in first["dwells"]] == [4000, 2000, 3000]
    assert first["pinned_version_number"] == 1 and first["outdated"] is False

    xml = editor_client.get(f"/dwell-files/{body['id']}/xml")
    assert 'filename="Northern_dwells.xml"' in xml.headers["content-disposition"]
    assert _canonical(xml.content) == _canonical(EXAMPLE)

    strategy = editor_client.get(f"/dwell-strategies/{second['strategy_id']}").json()
    assert strategy["rapid_df"] == {"collect_time": "50", "dwell_time": "50", "freq": "500"}
    assert strategy["used_in"][0]["file_name"] == "Northern dwells"


def test_a_strategy_is_edited_saved_and_repinned(editor_client):
    north = _platform(editor_client, "North Site")
    resp = editor_client.post("/dwell-strategies", json={"name": "Summer", "platform_id": north["id"]})
    assert resp.status_code == 201, resp.text
    strategy = resp.json()
    assert strategy["latest_version_number"] == 1 and strategy["manual_collect_time_ms"] == 50
    assert strategy["rapid_df"]["freq"] == "500" and strategy["dwells"] == []
    sid = strategy["id"]

    # The same name twice on one Platform isn't allowed; on another it is.
    assert editor_client.post("/dwell-strategies", json={"name": "Summer", "platform_id": north["id"]}).status_code == 409

    edited = editor_client.patch(
        f"/dwell-strategies/{sid}",
        json={"dwells": [{"freq_mhz": 9400, "dwell_time_ms": 100}, {"freq_mhz": 2950.5, "dwell_time_ms": 40}]},
    ).json()
    assert edited["dwells"][0] == {"freq_mhz": 9400, "dwell_time_ms": 100, "collect_time_ms": 50}
    assert edited["unsaved"] is True

    dwell_file = editor_client.post("/dwell-files", json={"name": "North file"}).json()
    dwell_file = editor_client.post(f"/dwell-files/{dwell_file['id']}/strategies", json={"strategy_id": sid}).json()
    assert dwell_file["links"][0]["pinned_version_number"] == 1 and dwell_file["unsaved"] is True

    saved = editor_client.post(f"/dwell-strategies/{sid}/versions", json={"change_summary": "Two dwells"})
    assert saved.status_code == 201 and saved.json()["version_number"] == 2
    diff = editor_client.get(f"/dwell-strategies/{sid}/versions/2/diff").json()
    assert [(e["scope"], e["kind"]) for e in diff["entries"]] == [("Dwell 1", "added"), ("Dwell 2", "added")]

    link = editor_client.get(f"/dwell-files/{dwell_file['id']}").json()["links"][0]
    assert link["outdated"] is True and link["latest_version_number"] == 2
    repinned = editor_client.post(f"/dwell-files/{dwell_file['id']}/strategies/repin-latest").json()
    assert repinned["links"][0]["pinned_version_number"] == 2
    root = etree.fromstring(editor_client.get(f"/dwell-files/{dwell_file['id']}/xml").content)
    assert [f.get("value") for f in root.findall("Strategy/MergedMode/Dwell/Freq")] == ["9400", "2950.5"]

    version = editor_client.post(f"/dwell-files/{dwell_file['id']}/versions", json={}).json()
    assert version["version_number"] == 2
    entries = editor_client.get(f"/dwell-files/{dwell_file['id']}/versions/2/diff").json()["entries"]
    assert entries == [
        {"scope": "Strategy 'Summer' (North Site)", "label": "Added", "kind": "added", "old_value": None, "new_value": "At its v2"}
    ]
    # In a file: can't be deleted.
    assert editor_client.delete(f"/dwell-strategies/{sid}").status_code == 409


def test_a_file_can_hold_several_strategies_for_one_platform(editor_client):
    north = _platform(editor_client, "North Site")
    summer = editor_client.post("/dwell-strategies", json={"name": "Summer", "platform_id": north["id"]}).json()
    winter = editor_client.post(
        "/dwell-strategies", json={"name": "Winter", "platform_id": north["id"], "copy_from_id": summer["id"]}
    ).json()
    assert winter["rapid_df"] == summer["rapid_df"]
    dwell_file = editor_client.post("/dwell-files", json={"name": "File"}).json()
    assert editor_client.post(f"/dwell-files/{dwell_file['id']}/strategies", json={"strategy_id": summer["id"]}).status_code == 200
    both = editor_client.post(f"/dwell-files/{dwell_file['id']}/strategies", json={"strategy_id": winter["id"]})
    assert both.status_code == 200, both.text
    assert [link["strategy_name"] for link in both.json()["links"]] == ["Summer", "Winter"]
    # The same Strategy twice is still refused.
    again = editor_client.post(f"/dwell-files/{dwell_file['id']}/strategies", json={"strategy_id": winter["id"]})
    assert again.status_code == 409 and "already in this file" in again.json()["detail"]


def test_bad_files_names_and_viewers_are_refused(editor_client, viewer_client):
    assert _import(editor_client, b"<Other/>").status_code == 422
    assert _import(editor_client, b"not xml").status_code == 422
    assert _import(editor_client).status_code == 201
    assert _import(editor_client).status_code == 409
    assert viewer_client.post("/dwell-files", json={"name": "Mine"}).status_code == 403
    assert viewer_client.get("/dwell-files").status_code == 200
    assert viewer_client.get("/dwell-strategies").status_code == 200


def test_bandwidth_default_is_an_admin_setting(admin_client, editor_client):
    assert editor_client.get("/settings").json() == {"dwell_bandwidth_mhz": 10.0}
    assert editor_client.patch("/settings", json={"dwell_bandwidth_mhz": 25}).status_code == 403
    assert admin_client.patch("/settings", json={"dwell_bandwidth_mhz": 25}).json() == {"dwell_bandwidth_mhz": 25}
    platform = _platform(editor_client, "Wide Site")
    strategy = editor_client.post("/dwell-strategies", json={"name": "Wide", "platform_id": platform["id"]}).json()
    assert editor_client.patch(f"/dwell-strategies/{strategy['id']}", json={"bandwidth_mhz": 40}).json()["bandwidth_mhz"] == 40


def test_an_mdf_version_keeps_the_dwell_files_it_was_saved_with(editor_client):
    platform = _platform(editor_client, "Dwell Platform")
    pv = editor_client.post(f"/platforms/{platform['id']}/versions", json={}).json()
    mdf = editor_client.post("/mdfs", json={"name": "Dwell MDF"}).json()
    editor_client.post(f"/mdfs/{mdf['id']}/links", json={"platform_id": platform["id"], "platform_version_id": pv["id"]})
    editor_client.post(f"/mdfs/{mdf['id']}/versions", json={})  # v1: no dwell file yet
    dwell_file = _import(editor_client).json()
    editor_client.patch(f"/dwell-strategies/{dwell_file['links'][0]['strategy_id']}", json={"platform_ids": [platform["id"]]})
    body = editor_client.patch(f"/dwell-files/{dwell_file['id']}", json={"mdf_id": mdf["id"]}).json()
    assert body["mdf_name"] == "Dwell MDF" and body["links"][0]["platforms_not_in_mdf"] == []

    def export(number):
        resp = editor_client.get(f"/mdfs/{mdf['id']}/versions/{number}/export/prs")
        return zipfile.ZipFile(io.BytesIO(resp.content))

    def readiness():
        checks = editor_client.get(f"/mdfs/{mdf['id']}/readiness").json()
        return next(c for c in checks if c["key"] == "dwells")

    # Changed, not saved: the MDF's readiness says saving the MDF saves it too.
    editor_client.patch(f"/dwell-files/{dwell_file['id']}", json={"timeout": 9})
    assert readiness()["status"] == "warn" and "saving the MDF saves it too" in readiness()["items"][0]

    v2 = editor_client.post(f"/mdfs/{mdf['id']}/versions", json={}).json()
    assert v2["version_number"] == 2
    versions = editor_client.get(f"/dwell-files/{dwell_file['id']}/versions").json()
    assert versions[-1]["change_summary"] == "Saved with MDF 'Dwell MDF'"
    assert readiness()["status"] == "ok"
    assert b'timeout="9"' in export(2).read("dwells/Northern_dwells.xml")
    assert not [n for n in export(1).namelist() if n.startswith("dwells/")]
    diff = editor_client.get(f"/mdfs/{mdf['id']}/versions/2/diff").json()["entries"]
    assert any(e["scope"] == "Dwell file 'Northern dwells'" and e["kind"] == "added" for e in diff)

    # Later changes, even saved, stay out of v2 until the MDF is saved again.
    editor_client.patch(f"/dwell-files/{dwell_file['id']}", json={"timeout": 4})
    editor_client.post(f"/dwell-files/{dwell_file['id']}/versions", json={})
    assert b'timeout="9"' in export(2).read("dwells/Northern_dwells.xml")
    assert "isn't in MDF v2 yet" in readiness()["items"][0]


def test_a_test_run_records_the_strategy_version_used(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Dwell Test Emitter"}).json()
    platform = _platform(editor_client, "Range Site")
    strategy = editor_client.post("/dwell-strategies", json={"name": "Range", "platform_id": platform["id"]}).json()
    version = editor_client.get(f"/dwell-strategies/{strategy['id']}/versions").json()[0]
    resp = editor_client.post(
        f"/emitters/{emitter['id']}/test-records",
        json={
            "test_type": "simulation",
            "title": "With a dwell",
            "received_power_dbfs": -40, "test_date": "2026-10-14",
            "simulation_created_date": "2026-10-10",
            "result": "pass",
            "dwell_strategy_version_id": version["id"],
        },
    )
    assert resp.status_code == 201, resp.text
    record = resp.json()
    assert (record["dwell_strategy_id"], record["dwell_strategy_name"], record["dwell_strategy_version_number"]) == (
        strategy["id"],
        "Range",
        1,
    )
    tests = editor_client.get(f"/dwell-strategies/{strategy['id']}").json()["tests"]
    assert [(t["kind"], t["owner_id"], t["title"], t["version_number"]) for t in tests] == [
        ("emitter", emitter["id"], "With a dwell", 1)
    ]
    # Used in a test: kept.
    assert editor_client.delete(f"/dwell-strategies/{strategy['id']}").status_code == 409


def test_saving_dwells_can_save_a_version_and_files_pin_it(editor_client):
    platform = _platform(editor_client, "Pin Site")
    strategy = editor_client.post(
        "/dwell-strategies", json={"name": "Patrol", "platform_id": platform["id"], "description": "  Coastal  "}
    ).json()
    assert strategy["description"] == "Coastal"
    saved = editor_client.patch(
        f"/dwell-strategies/{strategy['id']}",
        json={"dwells": [{"freq_mhz": 3030, "dwell_time_ms": 50}], "save_version": True, "change_summary": "First dwell"},
    ).json()
    assert saved["latest_version_number"] == 2 and saved["unsaved"] is False
    # Nothing changed: no new version.
    again = editor_client.patch(f"/dwell-strategies/{strategy['id']}", json={"save_version": True}).json()
    assert again["latest_version_number"] == 2
    versions = editor_client.get(f"/dwell-strategies/{strategy['id']}/versions").json()
    assert versions[-1]["change_summary"] == "First dwell"

    dwell_file = editor_client.post("/dwell-files", json={"name": "Pin file"}).json()
    link = editor_client.post(f"/dwell-files/{dwell_file['id']}/strategies", json={"strategy_id": strategy["id"]}).json()["links"][0]
    assert link["pinned_version_number"] == 2 and link["dwells"][0]["freq_mhz"] == 3030

    listed = next(s for s in editor_client.get("/dwell-strategies").json() if s["id"] == strategy["id"])
    assert listed["description"] == "Coastal"


def test_strategy_notes(editor_client, viewer_client):
    platform = _platform(editor_client, "Noted Site")
    strategy = editor_client.post("/dwell-strategies", json={"name": "Noted", "platform_id": platform["id"]}).json()
    note = editor_client.post(f"/dwell-strategies/{strategy['id']}/notes", json={"body": "Check X band"}).json()
    assert note["body"] == "Check X band" and note["author_username"]
    assert viewer_client.post(f"/dwell-strategies/{strategy['id']}/notes", json={"body": "no"}).status_code == 403
    assert [n["body"] for n in viewer_client.get(f"/dwell-strategies/{strategy['id']}/notes").json()] == ["Check X band"]
    assert editor_client.delete(f"/dwell-strategies/{strategy['id']}/notes/{note['id']}").status_code == 204
    assert editor_client.get(f"/dwell-strategies/{strategy['id']}/notes").json() == []


def test_default_dwells_and_strategies_for_several_platforms(editor_client):
    north = editor_client.post("/platforms", json={"name": "North Ship"}).json()
    south = editor_client.post("/platforms", json={"name": "South Ship"}).json()

    # No Platform: a default dwell.
    wide = editor_client.post("/dwell-strategies", json={"name": "Wide sweep"}).json()
    assert wide["is_default"] and wide["platform_ids"] == []
    assert editor_client.post("/dwell-strategies", json={"name": "Wide sweep"}).status_code == 409

    # Two Platforms at once.
    both = editor_client.post(
        "/dwell-strategies", json={"name": "Shared", "platform_ids": [north["id"], south["id"]]}
    ).json()
    assert both["platform_names"] == ["North Ship", "South Ship"] and not both["is_default"]
    # A name is taken on each Platform it covers.
    clash = editor_client.post("/dwell-strategies", json={"name": "Shared", "platform_ids": [south["id"]]})
    assert clash.status_code == 409 and "South Ship" in clash.json()["detail"]

    listed = {s["name"] for s in editor_client.get(f"/dwell-strategies?platform_id={south['id']}").json()}
    assert listed == {"Shared"}
    with_default = editor_client.get(f"/dwell-strategies?platform_id={south['id']}&include_default=true").json()
    assert {s["name"] for s in with_default} == {"Shared", "Wide sweep"}

    # Changing its Platforms is saved with the next version, and shows in the diff.
    resp = editor_client.patch(
        f"/dwell-strategies/{both['id']}", json={"platform_ids": [south["id"]], "save_version": True}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["platform_names"] == ["South Ship"]
    diff = editor_client.get(f"/dwell-strategies/{both['id']}/versions/2/diff").json()["entries"]
    assert any(e["label"] == "Platforms" and e["new_value"] == "South Ship" for e in diff)

    # A dwell file takes a Strategy for a Platform another of its Strategies covers.
    dwell_file = editor_client.post("/dwell-files", json={"name": "Fleet"}).json()
    for s in (wide, both):
        assert editor_client.post(f"/dwell-files/{dwell_file['id']}/strategies", json={"strategy_id": s["id"]}).status_code == 200
    other = editor_client.post("/dwell-strategies", json={"name": "South only", "platform_ids": [south["id"]]}).json()
    added = editor_client.post(f"/dwell-files/{dwell_file['id']}/strategies", json={"strategy_id": other["id"]})
    assert added.status_code == 200, added.text
    # And a Strategy in it can take on a Platform another one there covers.
    resp = editor_client.patch(f"/dwell-strategies/{other['id']}", json={"platform_ids": [south["id"], north["id"]]})
    assert resp.status_code == 200, resp.text
