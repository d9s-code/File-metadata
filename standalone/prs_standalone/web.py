"""The one web server the standalone app runs: the backend under /api, as
behind the production proxy, and the built frontend everywhere else."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from prs_standalone.pg import LocalPostgres


class SpaFiles(StaticFiles):
    """The built frontend; any path that isn't a file is a page of the app,
    so it gets index.html and the app's router takes it from there."""

    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as err:
            if err.status_code != 404 or path.startswith("assets/"):
                raise
            return await super().get_response("index.html", scope)


def build_app(frontend: Path, pg: LocalPostgres) -> FastAPI:
    from app.main import app as api

    from prs_standalone import offline

    offline.configure(pg)
    api.include_router(offline.router)

    root = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    root.mount("/api", api)
    if frontend.is_dir():
        root.mount("/", SpaFiles(directory=frontend, html=True), name="frontend")
    return root
