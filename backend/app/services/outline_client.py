"""Reading pages from an Outline wiki through its API — read-only.

Outline's API is POST-only JSON under /api, authorised with a bearer token.
The token belongs to an Outline account, and only what that account may read
in Outline is ever returned: access is decided there, not here.

Only the standard library is used, so nothing extra is needed offline.
"""

import json
import re
import ssl
import urllib.error
import urllib.request
from dataclasses import dataclass

from app.config import settings

PAGE_SIZE = 100


class OutlineError(Exception):
    """Outline couldn't be reached, or refused."""


class OutlineNotConfigured(OutlineError):
    pass


@dataclass
class OutlineDocument:
    id: str
    title: str
    text: str
    url: str
    updated_at: str | None
    parent_id: str | None


def enabled() -> bool:
    return bool(settings.outline_url and settings.outline_api_token)


def _base() -> str:
    if not enabled():
        raise OutlineNotConfigured("Outline isn't set up — set OUTLINE_URL and OUTLINE_API_TOKEN")
    return settings.outline_url.rstrip("/")


def _context() -> ssl.SSLContext | None:
    if settings.outline_ca_bundle:
        return ssl.create_default_context(cafile=settings.outline_ca_bundle)
    return None


def call(method: str, body: dict | None = None, timeout: float = 30) -> dict:
    """POST /api/<method> and return its JSON."""
    req = urllib.request.Request(
        f"{_base()}/api/{method}",
        data=json.dumps(body or {}).encode(),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {settings.outline_api_token}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_context()) as resp:
            return json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as err:
        detail = err.read().decode(errors="replace")[:300]
        hint = {401: " — is OUTLINE_API_TOKEN right?", 403: " — that account may not read this"}.get(err.code, "")
        raise OutlineError(f"Outline answered {err.code}{hint}: {detail}") from err
    except ssl.SSLError as err:
        raise OutlineError(
            f"Outline's certificate wasn't accepted ({err.reason}) — set OUTLINE_CA_BUNDLE to your CA's file"
        ) from err
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        reason = getattr(err, "reason", err)
        if isinstance(reason, ssl.SSLError):
            raise OutlineError(
                f"Outline's certificate wasn't accepted ({reason.reason}) — set OUTLINE_CA_BUNDLE to your CA's file"
            ) from err
        raise OutlineError(f"Couldn't reach Outline at {_base()}: {reason}") from err
    except json.JSONDecodeError as err:
        raise OutlineError("Outline sent something that isn't JSON — is OUTLINE_URL the wiki's address?") from err


def _paged(method: str, body: dict) -> list[dict]:
    out: list[dict] = []
    offset = 0
    while True:
        page = call(method, {**body, "limit": PAGE_SIZE, "offset": offset}).get("data") or []
        out += page
        if len(page) < PAGE_SIZE:
            return out
        offset += PAGE_SIZE


def whoami() -> dict:
    data = call("auth.info").get("data") or {}
    return {"user": (data.get("user") or {}).get("name"), "team": (data.get("team") or {}).get("name")}


def collections() -> list[dict]:
    return [{"id": c["id"], "name": c.get("name", "")} for c in _paged("collections.list", {})]


def find_collection(name_or_id: str) -> dict | None:
    wanted = name_or_id.strip().lower()
    for c in collections():
        if c["id"] == name_or_id or c["name"].strip().lower() == wanted:
            return c
    return None


def _document(d: dict) -> OutlineDocument:
    url = d.get("url") or ""
    return OutlineDocument(
        id=d["id"],
        title=d.get("title") or "(untitled)",
        text=d.get("text") or "",
        url=url if url.startswith("http") else f"{_base()}{url}",
        updated_at=d.get("updatedAt"),
        parent_id=d.get("parentDocumentId"),
    )


def documents(collection_id: str) -> list[OutlineDocument]:
    """Every published page in a collection, with its text (Markdown)."""
    docs = [_document(d) for d in _paged("documents.list", {"collectionId": collection_id})]
    for doc in docs:
        # Some Outline versions leave the text out of listings.
        if not doc.text:
            doc.text = (call("documents.info", {"id": doc.id}).get("data") or {}).get("text") or ""
    return docs


def search(query: str, collection_id: str | None = None, limit: int = 10) -> list[dict]:
    body: dict = {"query": query, "limit": limit}
    if collection_id:
        body["collectionId"] = collection_id
    return [
        {"title": (r.get("document") or {}).get("title"), "context": r.get("context") or "", "ranking": r.get("ranking")}
        for r in call("documents.search", body).get("data") or []
    ]


_HEADING = re.compile(r"^(#{1,4})\s+(.+?)\s*$", re.M)


def page_paths(docs: list[OutlineDocument]) -> dict[str, str]:
    """Each page's place in the collection's tree: "Parent › Child › Page"."""
    by_id = {d.id: d for d in docs}
    paths: dict[str, str] = {}

    def path(doc: OutlineDocument, seen: frozenset = frozenset()) -> str:
        if doc.id not in paths:
            parent = by_id.get(doc.parent_id or "")
            paths[doc.id] = (
                f"{path(parent, seen | {doc.id})} › {doc.title}" if parent and parent.id not in seen else doc.title
            )
        return paths[doc.id]

    for d in docs:
        path(d)
    return paths


def sections(doc: OutlineDocument, page_path: str | None = None) -> list[tuple[str, str]]:
    """A page split at its headings: (heading path, text) — the pieces a
    question would be given, each citable on its own. The path carries every
    heading above the piece, so "Stagger" under "Pulse processing" reads
    "Page › Pulse processing › Stagger"."""
    root = page_path or doc.title
    marks = list(_HEADING.finditer(doc.text))
    if not marks:
        return [(root, doc.text.strip())] if doc.text.strip() else []
    out = []
    intro = doc.text[: marks[0].start()].strip()
    if intro:
        out.append((root, intro))
    stack: list[tuple[int, str]] = []  # (level, heading) above the current one
    for i, m in enumerate(marks):
        level = len(m.group(1))
        while stack and stack[-1][0] >= level:
            stack.pop()
        stack.append((level, m.group(2)))
        body = doc.text[m.end() : marks[i + 1].start() if i + 1 < len(marks) else len(doc.text)].strip()
        if body:
            out.append((" › ".join([root, *(h for _, h in stack)]), body))
    return out


def estimate_tokens(text: str) -> int:
    """Roughly: about four characters a token for English prose."""
    return len(text) // 4
