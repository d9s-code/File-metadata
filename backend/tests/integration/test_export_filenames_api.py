import io
import re
import zipfile
from urllib.parse import unquote

from tests.integration.test_prs_import_api import FIXED_LINE

NAME = "Радар AN/APG-9 \"x\""


def _emitter_with_mode(client, name):
    e = client.post("/emitters", json={"name": name}).json()
    g = client.post(f"/emitters/{e['id']}/ew-groups", json={"name": "Search"}).json()
    s = client.post(f"/emitters/{e['id']}/sources", json={"name": "S", "source_date": "2025-01-01"}).json()
    client.post(f"/ew-groups/{g['id']}/modes", json={"source_id": s["id"], "name": "M", "pri_type": "fixed", "line": FIXED_LINE})
    return e


def test_emitter_export_with_non_latin_and_slash_name(editor_client):
    e = _emitter_with_mode(editor_client, NAME)
    resp = editor_client.post(f"/emitters/{e['id']}/export/xml")
    assert resp.status_code == 200, resp.text

    disposition = resp.headers["content-disposition"]
    utf8_name = unquote(re.search(r"filename\*=UTF-8''(\S+)", disposition).group(1))
    assert utf8_name == "Радар_AN_APG-9_x__xml_export.zip"
    assert disposition.isascii()

    names = zipfile.ZipFile(io.BytesIO(resp.content)).namelist()
    assert names == ["emitters/Радар_AN_APG-9_x_.xml"]


def test_platform_export_file_references_match_zip_entries(editor_client):
    e = _emitter_with_mode(editor_client, NAME)
    version = editor_client.post(f"/emitters/{e['id']}/versions", json={"change_summary": "v1"}).json()
    p = editor_client.post("/platforms", json={"name": "Ship/One"}).json()
    editor_client.post(f"/platforms/{p['id']}/links", json={"emitter_id": e["id"], "emitter_version_id": version["id"]})

    resp = editor_client.post(f"/platforms/{p['id']}/export/xml")
    assert resp.status_code == 200, resp.text
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = set(zf.namelist())
    assert names == {"emitters/Радар_AN_APG-9_x_.xml", "platforms/Ship_One.xml", "Ship_One_mdf.xml"}

    platform_xml = zf.read("platforms/Ship_One.xml").decode()
    referenced = re.findall(r"<EmitterFile[^>]*>([^<]+)</EmitterFile>", platform_xml)
    assert [r.replace("\\", "/") for r in referenced] == ["emitters/Радар_AN_APG-9_x_.xml"]
