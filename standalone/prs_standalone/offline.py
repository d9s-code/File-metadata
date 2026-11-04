"""The standalone app's own endpoints (/api/offline/…): fetching a copy from
the server, what has changed on this PC since, and syncing it back.

The PC keeps two databases: `prs`, the one the app runs on, and
`prs_baseline`, the copy exactly as it was fetched — what the PC's changes
are worked out against."""

from __future__ import annotations

import gzip
import json
import os
import socket
import threading
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import Role
from app.core.security import hash_password
from app.database import Base, engine as live_engine, get_db
from app.deps import require_role
from app.models.audit_log import AuditLog
from app.models.user import User
from app.services import sync_service
from prs_standalone.pg import LocalPostgres

router = APIRouter(prefix="/offline", tags=["offline"])

BASELINE_DB = "prs_baseline"
_pg: LocalPostgres | None = None
_lock = threading.Lock()  # one fetch or sync at a time
_server: "ServerSession | None" = None  # signed in to the server, while this app runs


def configure(pg: LocalPostgres) -> None:
    global _pg
    _pg = pg


def _data_dir() -> Path:
    return Path(os.environ["PRS_DATA_DIR"])


def _state() -> dict:
    path = _data_dir() / "offline.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _save_state(**values) -> None:
    path = _data_dir() / "offline.json"
    state = {**_state(), **values}
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def _logins() -> dict[str, str]:
    """username → this PC's own password hash, for each person who has signed in
    to the server from this PC. Only they can sign in here offline."""
    path = _data_dir() / "logins.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _remember_login(server: "ServerSession") -> None:
    logins = {**_logins(), server.username: server.local_hash}
    path = _data_dir() / "logins.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(logins, indent=2), encoding="utf-8")
    os.replace(tmp, path)
    _apply_logins()


def _apply_logins() -> None:
    """The copy from the server has no passwords; put back this PC's own."""
    logins = _logins()
    if not logins:
        return
    with live_engine.begin() as conn:
        for username, password_hash in logins.items():
            conn.execute(
                text("UPDATE users SET password_hash = :h WHERE username = :u"), {"h": password_hash, "u": username}
            )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --- The server --------------------------------------------------------------


class ServerSession:
    """Signed in to the server as a person, over its API (under /api, as the browser uses it)."""

    def __init__(self, url: str, username: str, password: str):
        self.url = url.rstrip("/")
        self.username = username
        self.client = httpx.Client(timeout=httpx.Timeout(30, read=600), verify=_tls(), follow_redirects=True)
        self.api = self._find_api()
        r = self.client.post(f"{self.api}/auth/login", json={"username": username, "password": password})
        if r.status_code in (401, 403):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "The server didn't accept that username and password")
        _raise_for(r, "Signing in to the server")
        # The server has just accepted this password: the PC's own hash of it lets
        # this person in offline. The password itself isn't kept.
        self.local_hash = hash_password(password)
        # Sent back by hand: a cookie jar won't return a Secure cookie over plain
        # http (a server on the local network without TLS), nor match "localhost".
        cookies = dict(r.cookies.items())
        self.client.cookies.clear()
        self.client.headers["cookie"] = "; ".join(f"{k}={v}" for k, v in cookies.items())
        if cookies.get("csrf_token"):
            self.client.headers["x-csrf-token"] = cookies["csrf_token"]

    def _find_api(self) -> str:
        for api in (f"{self.url}/api", self.url):
            try:
                r = self.client.get(f"{api}/health")
            except httpx.HTTPError as err:
                raise HTTPException(
                    status.HTTP_502_BAD_GATEWAY, f"Can't reach {self.url} from this PC ({type(err).__name__}: {err})"
                ) from err
            if r.status_code == 200 and "application/json" in r.headers.get("content-type", ""):
                return api
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"{self.url} doesn't look like the PRS app")

    def get(self, path: str) -> httpx.Response:
        return self.client.get(f"{self.api}{path}")

    def post(self, path: str, body: dict) -> httpx.Response:
        return self.client.post(f"{self.api}{path}", json=body)


def _tls():
    """Trust what Windows trusts (an organisation's own certificate authority, say)."""
    try:
        import ssl

        import truststore

        return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    except Exception:
        return True


def _raise_for(r: httpx.Response, doing: str) -> None:
    if r.status_code < 400:
        return
    try:
        detail = r.json().get("detail")
    except Exception:
        detail = r.text[:300]
    if isinstance(detail, dict):
        raise HTTPException(r.status_code, detail)
    raise HTTPException(r.status_code if r.status_code < 500 else 502, f"{doing}: {detail or r.reason_phrase}")


def _session() -> ServerSession:
    if _server is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Sign in to the server first")
    return _server


# --- The two databases ---------------------------------------------------------


def _baseline_engine():
    return create_engine(_pg.url(BASELINE_DB), pool_pre_ping=True)


def _fresh_baseline(schema: str | None):
    """An empty base database with this app's tables, at the server copy's version."""
    _pg.drop(BASELINE_DB)
    _pg.create(BASELINE_DB)
    eng = _baseline_engine()
    Base.metadata.create_all(eng)
    if schema:
        with eng.begin() as c:
            c.execute(text("CREATE TABLE alembic_version (version_num varchar(32) NOT NULL PRIMARY KEY)"))
            c.execute(text("INSERT INTO alembic_version VALUES (:v)"), {"v": schema})
    return eng


def _changes() -> dict:
    """What changed on this PC since the copy was fetched."""
    if not _state().get("fetched_at") or not _pg.exists(BASELINE_DB):
        return {"schema": None, "changes": [], "context": []}
    eng = _baseline_engine()
    try:
        with live_engine.connect() as local, eng.connect() as base:
            return sync_service.compute_changes(local, base)
    finally:
        eng.dispose()


def _load(copy: dict) -> dict:
    """The copy becomes both what the app runs on and the base."""
    with live_engine.begin() as conn:
        # Anything else still reading (another tab) gets 30 seconds, not forever.
        conn.execute(text("SET LOCAL lock_timeout = '30s'"))
        counts = sync_service.load_copy(conn, copy)
    eng = _fresh_baseline(copy.get("schema"))
    try:
        with eng.begin() as conn:
            sync_service.load_copy(conn, copy)
    finally:
        eng.dispose()
    return counts


def _keep_local_copy(reason: str) -> Path:
    """Everything on the PC as it is now, in a file — before it's replaced."""
    folder = _data_dir() / "before-replace"
    folder.mkdir(parents=True, exist_ok=True)
    with live_engine.connect() as conn:
        copy = sync_service.export_copy(conn, with_passwords=True)
    path = folder / f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{reason}.json.gz"
    path.write_bytes(gzip.compress(json.dumps(copy).encode()))
    # The newest ten are plenty.
    for old in sorted(folder.glob("*.json.gz"))[:-10]:
        old.unlink(missing_ok=True)
    return path


def _fetch_from(server: ServerSession, *, replacing: bool) -> dict:
    info = server.get("/sync/info")
    _raise_for(info, "Asking the server its version")
    with live_engine.connect() as conn:
        mine = sync_service.schema_version(conn)
    if info.json().get("schema") != mine:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"This app is a different version from the server's (database version {mine} here, "
            f"{info.json().get('schema')} on the server). Use the same version of the app as the server.",
        )
    r = server.get("/sync/copy")
    _raise_for(r, "Fetching the copy")
    copy = r.json()
    kept = _keep_local_copy("before-fetch") if replacing else None
    counts = _load(copy)
    _remember_login(server)
    _save_state(server_url=server.url, fetched_at=_now(), fetched_by=server.username)
    return {"rows": sum(counts.values()), "kept_copy": str(kept) if kept else None}


def _meaningful(changes: list[dict]) -> list[dict]:
    """Changes worth a person's attention: not sign-ins and the like."""
    return [c for c in changes if c["table"] != "audit_log"]


# --- Endpoints -------------------------------------------------------------------


class ServerLogin(BaseModel):
    server_url: str = Field(min_length=4, max_length=500)
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=200)


class SyncChoices(BaseModel):
    resolutions: dict[str, str] = Field(default_factory=dict)


@router.get("/status")
def offline_status(db: Session = Depends(get_db)) -> dict:
    """Open to anyone: the sign-in page needs it to know whether this PC has been set up."""
    state = _state()
    return {
        "standalone": True,
        "set_up": db.scalar(select(func.count()).select_from(User)) > 0,
        "server_url": state.get("server_url"),
        "fetched_at": state.get("fetched_at"),
        "fetched_by": state.get("fetched_by"),
        "synced_at": state.get("synced_at"),
        "connected_as": _server.username if _server else None,
        "device": socket.gethostname(),
    }


@router.post("/setup")
def set_up_from_server(
    body: ServerLogin, db: Session = Depends(get_db), content_type: str | None = Header(default=None)
) -> dict:
    """The first start: fetch everything from the server. Only while this PC
    has no users — after that, fetching needs signing in here first. (No CSRF
    token exists before anyone has signed in; a JSON body is what another
    web page can't send here without the browser stopping it.)"""
    global _server
    if not (content_type or "").startswith("application/json"):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Send the details as JSON")
    if db.scalar(select(func.count()).select_from(User)):
        raise HTTPException(status.HTTP_409_CONFLICT, "This PC is set up already — sign in to fetch again")
    db.close()
    with _lock:
        _server = ServerSession(body.server_url, body.username, body.password)
        return _fetch_from(_server, replacing=False)


class PersonLogin(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=200)


@router.post("/login-via-server")
def login_via_server(
    body: PersonLogin, db: Session = Depends(get_db), content_type: str | None = Header(default=None)
) -> dict:
    """Someone signing in on this PC for the first time: their password is checked
    with the server, and if the server takes it, this PC remembers them (its own
    hash) so they can sign in here from then on, offline too. Before anyone has
    signed in there's no CSRF token; a JSON body is what another page can't send."""
    if not (content_type or "").startswith("application/json"):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Send the details as JSON")
    url = _state().get("server_url")
    if not url:
        raise HTTPException(status.HTTP_409_CONFLICT, "This PC hasn't been set up from a server yet")
    known = db.scalar(select(func.count()).select_from(User).where(User.username == body.username)) > 0
    db.close()
    server = ServerSession(url, body.username, body.password)
    if not known:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "The server knows you, but this PC's copy is older than your account — an Admin can fetch a fresh copy under Admin → Sync",
        )
    _remember_login(server)
    return {"remembered": body.username}


@router.post("/connect", dependencies=[Depends(verify_csrf)])
def connect(body: ServerLogin, _=Depends(require_role(Role.admin))) -> dict:
    """Sign in to the server (kept while the app runs) — for fetching and syncing."""
    global _server
    _server = ServerSession(body.server_url, body.username, body.password)
    _remember_login(_server)
    _save_state(server_url=_server.url)
    info = _server.get("/sync/info")
    _raise_for(info, "Asking the server its version")
    return {"connected_as": _server.username, "server_schema": info.json().get("schema")}


@router.post("/disconnect", dependencies=[Depends(verify_csrf)])
def disconnect(_=Depends(require_role(Role.viewer))) -> dict:
    global _server
    _server = None
    return {"connected_as": None}


@router.get("/changes")
def local_changes(db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> dict:
    """What has been done on this PC since the copy was fetched: rows changed per
    kind, and the Audit Log entries made here."""
    state = _state()
    payload = _changes()
    per_table: dict[str, int] = {}
    for c in _meaningful(payload["changes"]):
        per_table[c["table"]] = per_table.get(c["table"], 0) + 1
    entries = []
    if state.get("fetched_at"):
        new_ids = {c["key"] for c in payload["changes"] if c["table"] == "audit_log" and c["base"] is None}
        if new_ids:
            rows = db.execute(
                select(AuditLog).where(AuditLog.entity_type != "auth").order_by(AuditLog.created_at.desc())
            ).scalars()
            entries = [
                {"at": r.created_at.isoformat(), "summary": r.summary, "action": r.action.name}
                for r in rows
                if str(r.id) in new_ids
            ][:200]
    return {"total": sum(per_table.values()), "per_table": per_table, "entries": entries, "fetched_at": state.get("fetched_at")}


@router.post("/fetch", dependencies=[Depends(verify_csrf)])
def fetch_again(force: bool = False, db: Session = Depends(get_db), _=Depends(require_role(Role.admin))) -> dict:
    """Replace what's on this PC with a fresh copy from the server. Refused while
    there are changes here not synced yet, unless forced (they're kept in a file)."""
    server = _session()
    db.close()  # this request's own reads mustn't hold up replacing the tables
    with _lock:
        if not force and _meaningful(_changes()["changes"]):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "This PC has changes the server doesn't have yet — sync them first, or fetch anyway to throw them away",
            )
        return _fetch_from(server, replacing=True)


@router.post("/preview", dependencies=[Depends(verify_csrf)])
def preview(body: SyncChoices, _=Depends(require_role(Role.admin))) -> dict:
    server = _session()
    with _lock:
        payload = _changes()
        r = server.post("/sync/preview", {"payload": payload, "resolutions": body.resolutions, "device": socket.gethostname()})
        _raise_for(r, "Comparing with the server")
        return {**r.json(), "local_changes": len(_meaningful(payload["changes"]))}


@router.post("/sync", dependencies=[Depends(verify_csrf)])
def sync(body: SyncChoices, db: Session = Depends(get_db), _=Depends(require_role(Role.admin))) -> dict:
    """Send this PC's changes to the server, then fetch a fresh copy — the PC
    then has exactly what the server has, everyone's changes included."""
    server = _session()
    db.close()  # this request's own reads mustn't hold up replacing the tables
    with _lock:
        payload = _changes()
        if not payload["changes"]:
            result = {"applied": {}, "notes": []}
        else:
            r = server.post("/sync/apply", {"payload": payload, "resolutions": body.resolutions, "device": socket.gethostname()})
            _raise_for(r, "Syncing")
            result = r.json()
        fetched = _fetch_from(server, replacing=True)
        _save_state(synced_at=_now())
        return {**result, "fetched_rows": fetched["rows"], "kept_copy": fetched["kept_copy"]}
