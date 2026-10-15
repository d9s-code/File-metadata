"""Dwell files: imported from and written as XML, one Dwell Strategy per
Platform, Merged Mode dwells edited; the charts' default bandwidth; the dwell
files of an MDF in its PRS export."""

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
    return client.post("/dwells/import", files={"file": ("north.xml", content, "application/xml")}, data={"name": name})


def _canonical(xml: bytes) -> bytes:
    parser = etree.XMLParser(remove_blank_text=True)
    return etree.tostring(etree.fromstring(xml, parser), method="c14n")


def test_import_then_export_gives_the_same_file(editor_client):
    resp = _import(editor_client)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "Northern dwells" and (body["timeout"], body["setup_time"]) == (5, 5)
    first = body["strategies"][0]
    assert first["platform_id"] is None and first["manual_collect_time_ms"] == 50
    # The file's frequencies are Hz; the app keeps MHz.
    assert [d["freq_mhz"] for d in first["merged_mode"]] == [0.004, 0.002, 0.003]
    assert first["rapid_df"] == {"collect_time": "50", "dwell_time": "50", "freq": "500"}
    assert first["split_mode"] == [{"collect_time": "50", "dwell_time": "50", "freqs": ["500", "750"]}]

    xml = editor_client.get(f"/dwells/{body['id']}/xml")
    assert xml.status_code == 200 and 'filename="Northern_dwells.xml"' in xml.headers["content-disposition"]
    assert _canonical(xml.content) == _canonical(EXAMPLE)


def test_edit_merged_mode_and_platforms(editor_client):
    dwell = _import(editor_client).json()
    north = editor_client.post("/platforms", json={"name": "North Site"}).json()
    south = editor_client.post("/platforms", json={"name": "South Site"}).json()
    s1, s2 = (s["id"] for s in dwell["strategies"])

    resp = editor_client.patch(
        f"/dwell-strategies/{s1}",
        json={
            "platform_id": north["id"],
            "manual_collect_time_ms": 60,
            "merged_mode": [
                {"freq_mhz": 9400, "dwell_time_ms": 100, "collect_time_ms": 50},
                {"freq_mhz": 2950.5, "dwell_time_ms": 40},
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    strategy = resp.json()["strategies"][0]
    assert strategy["platform_name"] == "North Site" and strategy["manual_collect_time_ms"] == 60
    assert strategy["merged_mode"][1] == {"freq_mhz": 2950.5, "dwell_time_ms": 40, "collect_time_ms": 50}

    # One Strategy per Platform in a file.
    assert editor_client.patch(f"/dwell-strategies/{s2}", json={"platform_id": north["id"]}).status_code == 409
    added = editor_client.post(f"/dwells/{dwell['id']}/strategies", json={"platform_id": south["id"]})
    assert added.status_code == 201 and len(added.json()["strategies"]) == 3
    # Bad values are refused.
    bad = editor_client.patch(f"/dwell-strategies/{s1}", json={"merged_mode": [{"freq_mhz": 0, "dwell_time_ms": 5}]})
    assert bad.status_code == 422

    root = etree.fromstring(editor_client.get(f"/dwells/{dwell['id']}/xml").content)
    strategy = root.findall("Strategy")[0]
    assert strategy.get("manual_collect_time") == "60"
    assert [d.find("Freq").get("value") for d in strategy.findall("MergedMode/Dwell")] == ["9400000000", "2950500000"]
    assert [d.get("dwell_time") for d in strategy.findall("MergedMode/Dwell")] == ["100", "40"]
    # A new Strategy starts with the default RapidDF and Split Mode.
    assert root.findall("Strategy")[2].find("RapidDF").get("freq") == "500"

    removed = editor_client.delete(f"/dwell-strategies/{s2}")
    assert removed.status_code == 200 and len(removed.json()["strategies"]) == 2


def test_bad_files_names_and_viewers_are_refused(editor_client, viewer_client):
    assert _import(editor_client, b"<Other/>").status_code == 422
    assert _import(editor_client, b"not xml").status_code == 422
    assert _import(editor_client).status_code == 201
    assert _import(editor_client).status_code == 409  # the name is taken
    assert viewer_client.post("/dwells", json={"name": "Mine"}).status_code == 403
    assert viewer_client.get("/dwells").status_code == 200


def test_bandwidth_default_is_an_admin_setting(admin_client, editor_client):
    assert editor_client.get("/settings").json() == {"dwell_bandwidth_mhz": 10.0}
    assert editor_client.patch("/settings", json={"dwell_bandwidth_mhz": 25}).status_code == 403
    assert admin_client.patch("/settings", json={"dwell_bandwidth_mhz": 25}).json() == {"dwell_bandwidth_mhz": 25}
    assert editor_client.get("/settings").json() == {"dwell_bandwidth_mhz": 25}
    # A dwell file can keep its own.
    dwell = editor_client.post("/dwells", json={"name": "Wide"}).json()
    assert editor_client.patch(f"/dwells/{dwell['id']}", json={"bandwidth_mhz": 40}).json()["bandwidth_mhz"] == 40
    assert editor_client.patch(f"/dwells/{dwell['id']}", json={"bandwidth_mhz": None}).json()["bandwidth_mhz"] is None


def test_an_mdf_export_carries_its_dwell_files(editor_client):
    platform = editor_client.post("/platforms", json={"name": "Dwell Platform"}).json()
    pv = editor_client.post(f"/platforms/{platform['id']}/versions", json={}).json()
    mdf = editor_client.post("/mdfs", json={"name": "Dwell MDF"}).json()
    editor_client.post(f"/mdfs/{mdf['id']}/links", json={"platform_id": platform["id"], "platform_version_id": pv["id"]})
    editor_client.post(f"/mdfs/{mdf['id']}/versions", json={})
    dwell = _import(editor_client).json()
    editor_client.patch(f"/dwells/{dwell['id']}", json={"mdf_id": mdf["id"]})
    s1 = dwell["strategies"][0]["id"]
    body = editor_client.patch(f"/dwell-strategies/{s1}", json={"platform_id": platform["id"]}).json()
    assert body["mdf_name"] == "Dwell MDF" and body["strategies"][0]["platform_in_mdf"] is True

    package = zipfile.ZipFile(io.BytesIO(editor_client.get(f"/mdfs/{mdf['id']}/versions/1/export/prs").content))
    assert "dwells/Northern_dwells.xml" in package.namelist()
    assert _canonical(package.read("dwells/Northern_dwells.xml")) == _canonical(EXAMPLE)
