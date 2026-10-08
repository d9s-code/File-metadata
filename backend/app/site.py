"""The whole app from one server, for the single-container deployment: the
API under /api, the built frontend (STATIC_DIR, copied in by the root
Dockerfile) everywhere else, falling back to index.html so the frontend's
own routes work on reload.

    uvicorn app.site:site

The API itself (app.main) knows nothing of /api — it's stripped here, the
way the reverse proxy used to strip it — so `uvicorn app.main:app` still
runs the API alone for development. The security headers the frontend's
nginx used to add go on every response.
"""

import logging
import os
from pathlib import Path

from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import FileResponse, PlainTextResponse
from starlette.staticfiles import StaticFiles
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.main import app as api

logger = logging.getLogger("uvicorn.error")

STATIC_DIR = Path(os.environ.get("STATIC_DIR", "/app/static"))
API_PREFIX = "/api"

NO_FRONTEND = (
    "The pages aren't in this image: there's no index.html in {dir}. The API is up under /api.\n"
    "Rebuild the image from the repository root (docker compose build app, or "
    "scripts/offline/build-images.sh), which builds the frontend into it, then docker compose up -d.\n"
)

# 'unsafe-inline' for styles only: React style={{...}} props and the charts
# render inline style attributes. Scripts stay 'self'-only.
SECURITY_HEADERS = [
    (
        b"content-security-policy",
        b"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
        b"font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; "
        b"frame-ancestors 'none'",
    ),
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"strict-origin-when-cross-origin"),
]


class Frontend(StaticFiles):
    """The built frontend. A path that isn't a file is one of the frontend's
    own routes: index.html. Vite's hashed /assets/ never change under the
    same name, so they're cached for good; everything else is revalidated,
    so a new deploy is picked up at once."""

    async def get_response(self, path: str, scope: Scope):
        # A missing build file is a 404 (never index.html cached as an asset);
        # any other missing path is one of the frontend's own routes.
        is_asset = path.startswith("assets/")
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404:
                raise
            if is_asset:
                return PlainTextResponse("Not Found", status_code=404)
            response = FileResponse(Path(str(self.directory)) / "index.html")
        if response.status_code == 404 and not is_asset:
            response = FileResponse(Path(str(self.directory)) / "index.html")
        if is_asset:
            response.headers["cache-control"] = "public, max-age=31536000, immutable"
        else:
            response.headers["cache-control"] = "no-cache"
        return response


class Site:
    def __init__(self, api_app: ASGIApp, frontend: ASGIApp | None):
        self.api = api_app
        self.frontend = frontend

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan":
            await self.api(scope, receive, send)
            return
        path = scope.get("path", "")
        if path == API_PREFIX or path.startswith(API_PREFIX + "/"):
            inner = {
                **scope,
                "path": path[len(API_PREFIX) :] or "/",
                "raw_path": (scope.get("raw_path") or path.encode())[len(API_PREFIX) :] or b"/",
                "root_path": scope.get("root_path", "") + API_PREFIX,
            }
            await self.api(inner, receive, _with_headers(send))
        elif self.frontend is not None:
            await self.frontend(scope, receive, _with_headers(send))
        elif path == "/":
            await PlainTextResponse(NO_FRONTEND.format(dir=STATIC_DIR), status_code=404)(scope, receive, send)
        else:
            await self.api(scope, receive, send)


def _with_headers(send: Send) -> Send:
    async def wrapped(message: Message) -> None:
        if message["type"] == "http.response.start":
            present = {name for name, _ in message.get("headers", [])}
            message["headers"] = [*message.get("headers", []), *(h for h in SECURITY_HEADERS if h[0] not in present)]
        await send(message)

    return wrapped


if (STATIC_DIR / "index.html").is_file():
    logger.info("Serving the pages from %s and the API under %s", STATIC_DIR, API_PREFIX)
    site = Site(api, Frontend(directory=STATIC_DIR))
else:
    logger.warning("No index.html in %s: serving the API only. Rebuild the image to include the pages.", STATIC_DIR)
    site = Site(api, None)
