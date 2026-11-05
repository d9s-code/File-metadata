"""Files kept with Emitters, Platforms and MDFs: any kind, a picture shown
with a preview, the rest downloaded — described, put in order, deleted,
audited, and carried by the offline copy."""

import io

from PIL import Image

from app.routers import attachments as attachments_router
from tests.integration.sync_support import make_emitter, sync_apply

XLSX = b"PK\x03\x04" + b"\x00" * 200 + b"spreadsheet"
XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _png(w=640, h=400, color=(200, 30, 30), alpha=False) -> bytes:
    img = Image.new("RGBA" if alpha else "RGB", (w, h), color + ((128,) if alpha else ()))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def _sideways_jpeg() -> bytes:
    """A phone photo stored 600×300 with "turn it 90°" in its EXIF: shown 300×600."""
    img = Image.new("RGB", (600, 300), (10, 120, 200))
    exif = Image.Exif()
    exif[0x0112] = 6
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif)
    return buf.getvalue()


def _upload(client, owner, owner_id, data, name="photo.png", description=None):
    form = {"owner": owner, "owner_id": owner_id}
    if description is not None:
        form["description"] = description
    return client.post("/attachments", data=form, files={"file": (name, data, "application/octet-stream")})


def _list(client, owner, owner_id):
    r = client.get("/attachments", params={"owner": owner, "owner_id": owner_id})
    assert r.status_code == 200, r.text
    return r.json()


def test_a_spreadsheet_is_kept_and_only_ever_downloaded(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Filed Radar"}).json()
    r = _upload(editor_client, "emitter", emitter["id"], XLSX, name="Parameters 2025.xlsx", description="  Range table ")
    assert r.status_code == 201, r.text
    f = r.json()
    assert (f["filename"], f["content_type"], f["is_image"], f["width"]) == ("Parameters 2025.xlsx", XLSX_TYPE, False, None)
    assert f["description"] == "Range table" and f["size_bytes"] == len(XLSX)

    got = editor_client.get(f"/attachments/{f['id']}/file")
    assert got.content == XLSX and got.headers["content-type"] == XLSX_TYPE
    assert got.headers["content-disposition"].startswith("attachment;") and "Parameters%202025.xlsx" in got.headers["content-disposition"]
    assert "sandbox" in got.headers["content-security-policy"] and got.headers["x-content-type-options"] == "nosniff"
    assert editor_client.get(f"/attachments/{f['id']}/thumb").status_code == 404


def test_a_page_of_html_is_never_shown_as_a_page(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Careful Radar"}).json()
    f = _upload(editor_client, "emitter", emitter["id"], b"<script>alert(1)</script>", name="x.html").json()
    got = editor_client.get(f"/attachments/{f['id']}/file")
    assert got.headers["content-disposition"].startswith("attachment;")
    assert "sandbox" in got.headers["content-security-policy"]
    # Nor does a file that only calls itself a picture get shown as one.
    fake = _upload(editor_client, "emitter", emitter["id"], b"<svg onload=alert(1)>", name="logo.png").json()
    assert fake["is_image"] is False
    assert editor_client.get(f"/attachments/{fake['id']}/file").headers["content-disposition"].startswith("attachment;")


def test_a_pdf_opens_in_the_browser(editor_client):
    platform = editor_client.post("/platforms", json={"name": "Filed Ship"}).json()
    pdf = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
    f = _upload(editor_client, "platform", platform["id"], pdf, name="manual.pdf").json()
    got = editor_client.get(f"/attachments/{f['id']}/file")
    assert got.headers["content-type"] == "application/pdf" and got.headers["content-disposition"].startswith("inline;")
    download = editor_client.get(f"/attachments/{f['id']}/file", params={"download": "true"})
    assert download.headers["content-disposition"].startswith("attachment;")


def test_a_picture_gets_a_preview_and_is_shown(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Pictured Radar"}).json()
    data = _png()
    pic = _upload(editor_client, "emitter", emitter["id"], data, name="mast.png").json()
    assert (pic["content_type"], pic["is_image"], pic["width"], pic["height"]) == ("image/png", True, 640, 400)
    file = editor_client.get(f"/attachments/{pic['id']}/file")
    assert file.content == data and file.headers["content-disposition"].startswith("inline;")
    thumb = editor_client.get(f"/attachments/{pic['id']}/thumb")
    assert thumb.headers["content-type"] == "image/webp"
    assert Image.open(io.BytesIO(thumb.content)).size == (480, 300)

    photo = _upload(editor_client, "emitter", emitter["id"], _sideways_jpeg(), name="IMG_0001.JPG").json()
    assert (photo["width"], photo["height"]) == (300, 600)
    clear = _upload(editor_client, "emitter", emitter["id"], _png(alpha=True), name="logo.png").json()
    assert Image.open(io.BytesIO(editor_client.get(f"/attachments/{clear['id']}/thumb").content)).mode == "RGBA"
    # A damaged picture is still kept — as a file, without a preview.
    broken = _upload(editor_client, "emitter", emitter["id"], _png()[:200], name="broken.png").json()
    assert broken["is_image"] is False


def test_files_are_described_reordered_and_deleted_in_the_audit_log(editor_client):
    mdf = editor_client.post("/mdfs", json={"name": "Filed MDF"}).json()
    ids = [_upload(editor_client, "mdf", mdf["id"], XLSX, name=f"{i}.xlsx").json()["id"] for i in range(3)]
    assert [a["id"] for a in _list(editor_client, "mdf", mdf["id"])] == ids

    new_order = [ids[2], ids[0], ids[1]]
    r = editor_client.put("/attachments/order", json={"owner": "mdf", "owner_id": mdf["id"], "ids": new_order})
    assert r.status_code == 200, r.text
    assert [a["id"] for a in _list(editor_client, "mdf", mdf["id"])] == new_order
    stale = editor_client.put("/attachments/order", json={"owner": "mdf", "owner_id": mdf["id"], "ids": ids[:2]})
    assert stale.status_code == 409

    patched = editor_client.patch(f"/attachments/{ids[0]}", json={"description": "First issue"})
    assert patched.json()["description"] == "First issue"
    assert editor_client.delete(f"/attachments/{ids[0]}").status_code == 204
    assert len(_list(editor_client, "mdf", mdf["id"])) == 2

    summaries = [x["summary"] for x in editor_client.get("/audit-log", params={"entity_type": "attachment"}).json()["items"]]
    assert "Added file '0.xlsx' to MDF 'Filed MDF'" in summaries
    assert "Reordered the files of MDF 'Filed MDF'" in summaries
    assert "Changed the description of file '0.xlsx' on MDF 'Filed MDF'" in summaries
    assert "Deleted file '0.xlsx' from MDF 'Filed MDF'" in summaries


def test_empty_and_too_large_files_are_refused(editor_client, monkeypatch):
    emitter = editor_client.post("/emitters", json={"name": "Big File Radar"}).json()
    assert _upload(editor_client, "emitter", emitter["id"], b"", name="empty.xlsx").status_code == 422
    monkeypatch.setattr(attachments_router, "MAX_BYTES", 100)
    r = _upload(editor_client, "emitter", emitter["id"], XLSX, name="big.xlsx")
    assert r.status_code == 413 and "MB" in r.json()["detail"]
    assert _list(editor_client, "emitter", emitter["id"]) == []


def test_viewers_look_editors_change_and_the_trash_is_left_alone(editor_client, viewer_client):
    emitter = editor_client.post("/emitters", json={"name": "Watched Radar"}).json()
    f = _upload(editor_client, "emitter", emitter["id"], XLSX, name="a.xlsx").json()
    assert len(_list(viewer_client, "emitter", emitter["id"])) == 1
    assert viewer_client.get(f"/attachments/{f['id']}/file").status_code == 200
    assert _upload(viewer_client, "emitter", emitter["id"], XLSX).status_code == 403
    assert viewer_client.delete(f"/attachments/{f['id']}").status_code == 403

    assert editor_client.delete(f"/emitters/{emitter['id']}").status_code == 204
    assert _upload(editor_client, "emitter", emitter["id"], XLSX).status_code == 409
    assert editor_client.delete(f"/attachments/{f['id']}").status_code == 409
    assert len(_list(editor_client, "emitter", emitter["id"])) == 1
    missing = editor_client.get("/attachments", params={"owner": "platform", "owner_id": emitter["id"]})
    assert missing.status_code == 404


def test_a_file_added_offline_reaches_the_server(admin_client, pc):
    server = admin_client
    e, _g, _s = make_emitter(server)
    on_server = _upload(server, "emitter", e["id"], _png(), name="before.png").json()
    pc.take_copy(server)

    with pc.client() as laptop:
        # The copy has the server's file, contents and all.
        assert laptop.get(f"/attachments/{on_server['id']}/file").content == _png()
        added = _upload(laptop, "emitter", e["id"], XLSX, name="field notes.xlsx", description="From the field")
        assert added.status_code == 201, added.text
        added = added.json()

    r = sync_apply(server, pc.changes())
    assert r.status_code == 200, r.text
    listed = _list(server, "emitter", e["id"])
    assert [a["filename"] for a in listed] == ["before.png", "field notes.xlsx"]
    assert server.get(f"/attachments/{added['id']}/file").content == XLSX
    assert listed[1]["description"] == "From the field"
