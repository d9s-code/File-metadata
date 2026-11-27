"""The one web server the standalone app runs: the backend under /api, as
behind the production proxy, and the built frontend everywhere else."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.gzip import GZipMiddleware

from prs_standalone.pg import LocalPostgres


class SpaFiles(StaticFiles):
    """The built frontend; any path that isn't a file is a page of the app,
    so it gets index.html and the app's router takes it from there."""

    async def get_response(self, path, scope):
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as err:
            if err.status_code != 404 or path.startswith("assets/"):
                raise
            response = await super().get_response("index.html", scope)
            path = "index.html"
        # The built files under assets/ are named by their content, so the
        # browser keeps them for good; index.html is checked every time, so
        # a new build is picked up at once.
        if path.startswith("assets/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            response.headers["Cache-Control"] = "no-cache"
        return response


def build_app(frontend: Path, pg: LocalPostgres) -> FastAPI:
    from app.main import app as api

    from prs_standalone import offline

    offline.configure(pg)
    api.include_router(offline.router)

    root = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    # The frontend's script and styles compressed (the API compresses its own).
    root.add_middleware(GZipMiddleware, minimum_size=1024)
    root.mount("/api", api)
    if frontend.is_dir():
        root.mount("/", SpaFiles(directory=frontend, html=True), name="frontend")
    return root
