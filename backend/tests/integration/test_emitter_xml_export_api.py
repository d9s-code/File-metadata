

def test_several_emitters_export_as_one_archive(editor_client, viewer_client):
    import io
    import zipfile

    a = editor_client.post("/emitters", json={"name": "Batch Export A"}).json()
    b = editor_client.post("/emitters", json={"name": "Batch Export B"}).json()
    resp = viewer_client.post("/emitters/export/xml", json={"emitter_ids": [a["id"], b["id"]]})
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/zip"
    names = zipfile.ZipFile(io.BytesIO(resp.content)).namelist()
    assert names == ["emitters/Batch_Export_A.xml", "emitters/Batch_Export_B.xml"]
    missing = viewer_client.post("/emitters/export/xml", json={"emitter_ids": [a["id"], "00000000-0000-0000-0000-000000000000"]})
    assert missing.status_code == 404
    assert viewer_client.post("/emitters/export/xml", json={"emitter_ids": []}).status_code == 422
