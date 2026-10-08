"""The single-container server: the API under /api, the built frontend
everywhere else (index.html for the frontend's own routes), with the
security headers the frontend's web server used to add."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.site import Frontend, Site


def _client(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<html>app</html>")
    (tmp_path / "assets" / "main-abc123.js").write_text("console.log(1)")
    api = FastAPI()

    @api.get("/health")
    def health():
        return {"ok": True}

    return TestClient(Site(api, Frontend(directory=tmp_path)))


def test_the_api_is_under_api_and_the_frontend_everywhere_else(tmp_path):
    client = _client(tmp_path)
    assert client.get("/api/health").json() == {"ok": True}
    assert client.get("/api/nope").status_code == 404
    for path in ("/", "/emitters/123", "/login"):
        resp = client.get(path)
        assert resp.status_code == 200 and "app" in resp.text
        assert resp.headers["cache-control"] == "no-cache"
    assert client.get("/assets/missing-000.js").status_code == 404
    asset = client.get("/assets/main-abc123.js")
    assert asset.status_code == 200 and "immutable" in asset.headers["cache-control"]


def test_every_response_carries_the_security_headers(tmp_path):
    client = _client(tmp_path)
    for path in ("/", "/api/health"):
        headers = client.get(path).headers
        assert "frame-ancestors 'none'" in headers["content-security-policy"]
        assert headers["x-frame-options"] == "DENY"
        assert headers["x-content-type-options"] == "nosniff"


def test_without_a_built_frontend_it_is_just_the_api():
    api = FastAPI()

    @api.get("/health")
    def health():
        return {"ok": True}

    client = TestClient(Site(api, None))
    assert client.get("/health").json() == {"ok": True}
    assert client.get("/api/health").json() == {"ok": True}
    # Opening the site says why there are no pages, not a bare API 404.
    root = client.get("/")
    assert root.status_code == 404 and "no index.html" in root.text
