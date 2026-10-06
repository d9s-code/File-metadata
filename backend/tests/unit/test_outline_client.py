"""Reading Outline through its API, against a small fake Outline server."""

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from app.config import settings
from app.services import outline_client

TOKEN = "ol_api_test"

STAGGER_PAGE = """How the sensor recognises staggered PRI.

## Frame detection
The sensor sums consecutive intervals to find the frame.

## Tolerances
Each step is matched within the Mode's margin.
"""


class FakeOutline:
    def __init__(self, pages: int = 1):
        # Enough pages to need a second request when asked.
        self.docs = [
            {
                "id": f"doc-{i}",
                "title": f"Page {i}",
                "text": f"Text of page {i}.",
                "url": f"/doc/page-{i}",
                "updatedAt": "2026-10-01T10:00:00Z",
                "parentDocumentId": None,
            }
            for i in range(pages)
        ]
        self.docs[0] = {**self.docs[0], "title": "Stagger logic", "text": STAGGER_PAGE}
        for d in self.docs:
            d.setdefault("collectionId", "col-prs")
        # One page whose listing leaves its text out.
        self.docs.append({**self.docs[-1], "id": "doc-lazy", "title": "Lazy page", "text": ""})
        self.calls: list[tuple[str, dict]] = []

    def handler(self):
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _send(self, code: int, payload: dict):
                body = json.dumps(payload).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])) or b"{}")
                method = self.path.removeprefix("/api/")
                fake.calls.append((method, body))
                # Like Outline with FORCE_HTTPS: plain HTTP from no proxy is refused.
                if self.headers.get("X-Forwarded-Proto") != "https":
                    self._send(405, {"error": "Please use HTTPS when submitting data to this server"})
                    return
                if self.headers.get("Authorization") != f"Bearer {TOKEN}":
                    self._send(401, {"error": "authentication_required"})
                    return
                offset, limit = body.get("offset", 0), body.get("limit", 25)
                if method == "auth.info":
                    self._send(200, {"data": {"user": {"name": "PRS reader"}, "team": {"name": "EW"}}})
                elif method == "collections.list":
                    self._send(200, {"data": [{"id": "col-prs", "name": "PRS"}, {"id": "col-x", "name": "Other"}]})
                elif method == "documents.list":
                    self._send(200, {"data": fake.docs[offset : offset + limit]})
                elif method == "documents.info":
                    doc = next((d for d in fake.docs if body["id"] in (d["id"], d.get("urlId"))), None)
                    if doc is None:
                        self._send(404, {"error": "not_found"})
                    else:
                        self._send(200, {"data": {**doc, "text": doc["text"] or "Text fetched on its own."}})
                elif method == "documents.search":
                    self._send(
                        200,
                        {"data": [{"ranking": 1.0, "context": "the <b>frame</b> is found", "document": {"title": "Stagger logic"}}]},
                    )
                else:
                    self._send(404, {})

        return Handler


@pytest.fixture()
def outline(monkeypatch):
    def start(pages: int = 1):
        fake = FakeOutline(pages)
        server = HTTPServer(("127.0.0.1", 0), fake.handler())
        threading.Thread(target=server.serve_forever, daemon=True).start()
        monkeypatch.setattr(settings, "outline_url", f"http://127.0.0.1:{server.server_port}/")
        monkeypatch.setattr(settings, "outline_api_token", TOKEN)
        monkeypatch.setattr(settings, "outline_collection", None)
        monkeypatch.setattr(settings, "llm_base_url", None)
        servers.append(server)
        return fake

    servers: list[HTTPServer] = []
    yield start
    for s in servers:
        s.shutdown()


def test_not_set_up_until_url_and_token(monkeypatch):
    monkeypatch.setattr(settings, "outline_url", "https://outline.app")
    monkeypatch.setattr(settings, "outline_api_token", None)
    assert outline_client.enabled() is False
    with pytest.raises(outline_client.OutlineNotConfigured):
        outline_client.collections()


def test_reads_a_collection_page_by_page_and_fills_missing_text(outline):
    fake = outline(pages=150)
    assert outline_client.whoami() == {"user": "PRS reader", "team": "EW"}
    assert outline_client.find_collection("prs")["id"] == "col-prs"

    docs = outline_client.documents("col-prs")
    assert len(docs) == 151
    assert [b["offset"] for m, b in fake.calls if m == "documents.list"] == [0, 100]
    lazy = next(d for d in docs if d.id == "doc-lazy")
    assert lazy.text == "Text fetched on its own."
    assert docs[0].url.endswith("/doc/page-0") and docs[0].url.startswith("http://127.0.0.1")


def test_a_page_splits_into_citable_sections(outline):
    outline()
    page = outline_client.documents("col-prs")[0]
    assert outline_client.sections(page) == [
        ("Stagger logic", "How the sensor recognises staggered PRI."),
        ("Stagger logic › Frame detection", "The sensor sums consecutive intervals to find the frame."),
        ("Stagger logic › Tolerances", "Each step is matched within the Mode's margin."),
    ]


def test_section_paths_follow_the_headings_and_the_page_tree():
    parent = outline_client.OutlineDocument("p", "Sensor logic", "", "", None, None)
    child = outline_client.OutlineDocument(
        "c",
        "Pulse processing",
        "Intro.\n# Stagger\nAbout stagger.\n## Frame\nFrame text.\n## Steps\nStep text.\n# Jitter\nJitter text.",
        "",
        None,
        "p",
    )
    paths = outline_client.page_paths([parent, child])
    assert paths["c"] == "Sensor logic › Pulse processing"
    assert [h for h, _ in outline_client.sections(child, paths["c"])] == [
        "Sensor logic › Pulse processing",
        "Sensor logic › Pulse processing › Stagger",
        "Sensor logic › Pulse processing › Stagger › Frame",
        "Sensor logic › Pulse processing › Stagger › Steps",
        "Sensor logic › Pulse processing › Jitter",
    ]


def test_a_page_and_everything_under_it(outline, monkeypatch):
    fake = outline()
    # Group 1 (the collection) › PRS › PRS documentation › Annex, and an unrelated page.
    fake.docs = [
        {"id": "prs", "urlId": "AbC123xyz", "title": "PRS", "text": "Overview.", "url": "/doc/prs-AbC123xyz",
         "parentDocumentId": None, "collectionId": "col-prs"},
        {"id": "doc", "title": "PRS documentation", "text": "# Stagger\nStagger text.", "url": "/doc/prs-documentation-x1",
         "parentDocumentId": "prs", "collectionId": "col-prs"},
        {"id": "annex", "title": "Annex", "text": "Annex text.", "url": "/doc/annex-x2",
         "parentDocumentId": "doc", "collectionId": "col-prs"},
        {"id": "other", "title": "Holiday rota", "text": "Not this.", "url": "/doc/holiday-rota-x3",
         "parentDocumentId": None, "collectionId": "col-prs"},
    ]
    monkeypatch.setattr(settings, "outline_root", "https://outline.app/doc/prs-AbC123xyz")
    label, docs = outline_client.scope()
    assert label == '"PRS" and the 2 pages under it, in collection "PRS"'
    assert [d.title for d in docs] == ["PRS", "PRS documentation", "Annex"]
    paths = outline_client.page_paths(docs)
    assert outline_client.sections(docs[1], paths["doc"]) == [("PRS › PRS documentation › Stagger", "Stagger text.")]

    # By its exact title too; and a title that isn't there says so.
    monkeypatch.setattr(settings, "outline_root", "prs")
    assert [d.title for d in outline_client.scope()[1]] == ["PRS", "PRS documentation", "Annex"]
    monkeypatch.setattr(settings, "outline_root", "Nope")
    with pytest.raises(outline_client.OutlineError, match='No page titled "Nope"'):
        outline_client.scope()


def test_links_use_the_public_address_when_reached_another_way(outline, monkeypatch):
    outline()
    monkeypatch.setattr(settings, "outline_public_url", "https://outline.app/")
    assert outline_client.documents("col-prs")[0].url == "https://outline.app/doc/page-0"


def test_https_to_a_plain_http_address_says_so(outline, monkeypatch):
    outline()
    monkeypatch.setattr(settings, "outline_url", settings.outline_url.replace("http://", "https://"))
    with pytest.raises(outline_client.OutlineError, match="answers in plain HTTP"):
        outline_client.whoami()


def test_a_wrong_token_says_so(outline, monkeypatch):
    outline()
    monkeypatch.setattr(settings, "outline_api_token", "wrong")
    with pytest.raises(outline_client.OutlineError, match="OUTLINE_API_TOKEN"):
        outline_client.whoami()


def test_a_key_scoped_too_narrowly_says_so(outline, monkeypatch):
    """Outline answers 401, not 403, on documents.info when the key's scopes
    leave it out: the hint must point at the scopes, not the token."""
    outline()
    monkeypatch.setattr(settings, "outline_api_token", "wrong")
    with pytest.raises(outline_client.OutlineError, match="scopes probably don't include documents.info"):
        outline_client.document("abc123")


def test_the_probe_script_reports_size_and_search(outline, capsys, monkeypatch):
    outline()
    import scripts.outline_probe as probe

    monkeypatch.setattr(
        "sys.argv", ["outline_probe.py", "--tree", "--collection", "PRS", "--search", "frame", "--sections"]
    )
    assert probe.main() == 0
    out = capsys.readouterr().out
    assert "Signed in as PRS reader (team EW)" in out
    assert 'Reading collection "PRS": 2 pages' in out
    assert "    Lazy page" in out  # --tree
    assert "Stagger logic" in out
    assert "Small enough to send the whole collection" in out
    assert "Stagger logic: the frame is found" in out
    assert "Stagger logic › Frame detection" in out
    assert "very short: merge" in out
