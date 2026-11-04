"""Starts the standalone app: its own PostgreSQL, the backend under /api and
the built frontend, on 127.0.0.1 — then opens it in the browser.

    PRS.exe                 (the Windows build)
    python -m prs_standalone (from source: run in standalone/, see README)

Everything it keeps — the database, its settings, the copy last fetched from
the server — is in one folder: %LOCALAPPDATA%\\PRS on Windows (PRS_DATA_DIR to
choose another).
"""

from __future__ import annotations

import json
import os
import secrets
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

from prs_standalone.pg import IS_WINDOWS, LocalPostgres, PostgresError, app_dir, default_data_dir, find_bin_dir, free_port

LIVE_DB = "prs"
DEFAULT_WEB_PORT = 8765


def bundle_dir() -> Path:
    """Where the backend and frontend files are: inside the frozen bundle, or the repo."""
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent.parent.parent


def backend_dir() -> Path:
    return bundle_dir() / "backend"


def frontend_dir() -> Path:
    frozen = bundle_dir() / "frontend_dist"
    return frozen if frozen.is_dir() else bundle_dir() / "frontend" / "dist-standalone"


class Config:
    """The app's settings on this PC, kept in config.json in the data folder."""

    def __init__(self, path: Path):
        self.path = path
        self.values: dict = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        changed = False
        for key in ("jwt_secret", "pg_password"):
            if not self.values.get(key):
                self.values[key] = secrets.token_hex(32)
                changed = True
        if changed:
            self.save()

    def get(self, key: str, default=None):
        return self.values.get(key, default)

    def set(self, **values) -> None:
        self.values.update(values)
        self.save()

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.values, indent=2), encoding="utf-8")
        os.replace(tmp, self.path)


def _already_running(data_dir: Path) -> int | None:
    """The port of a copy of the app already running from this data folder, if any."""
    marker = data_dir / "running.json"
    if not marker.exists():
        return None
    try:
        port = json.loads(marker.read_text())["port"]
        urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=2)
        return port
    except Exception:
        return None


def configure_environment(data_dir: Path, cfg: Config, pg: LocalPostgres, web_port: int) -> None:
    """The backend reads its settings from the environment when it's imported."""
    os.environ.update(
        {
            "APP_ENV": "standalone",
            "PRS_STANDALONE": "1",
            "PRS_DATA_DIR": str(data_dir),
            "DATABASE_URL": pg.url(LIVE_DB),
            "JWT_SECRET": cfg.get("jwt_secret"),
            # Plain HTTP on 127.0.0.1: the browser wouldn't send a Secure cookie back.
            "COOKIE_SECURE": "false",
            "CORS_ORIGINS": json.dumps([f"http://127.0.0.1:{web_port}", f"http://localhost:{web_port}"]),
            "BACKUP_DIR": str(data_dir / "backups"),
        }
    )
    # The backup and restore code calls pg_dump / pg_restore by name.
    os.environ["PATH"] = str(pg.bin_dir) + os.pathsep + os.environ.get("PATH", "")
    if str(backend_dir()) not in sys.path:
        sys.path.insert(0, str(backend_dir()))


def migrate() -> None:
    """Brings the local database up to this version of the app."""
    from alembic import command
    from alembic.config import Config as AlembicConfig

    cfg = AlembicConfig()
    cfg.set_main_option("script_location", str(backend_dir() / "alembic"))
    command.upgrade(cfg, "head")


def _stop_on_console_close(pg: LocalPostgres) -> None:
    """Closing the console window doesn't run `finally` blocks on Windows:
    stop the database from the close event instead."""
    if not IS_WINDOWS:
        return
    import ctypes

    handler_type = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_uint)

    def handler(_event: int) -> bool:
        pg.stop()
        return False

    _stop_on_console_close.keep = handler_type(handler)  # keep it alive
    ctypes.windll.kernel32.SetConsoleCtrlHandler(_stop_on_console_close.keep, True)


def main() -> None:
    data_dir = default_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    if port := _already_running(data_dir):
        print(f"PRS is already running — opening http://127.0.0.1:{port}")
        webbrowser.open(f"http://127.0.0.1:{port}")
        return

    cfg = Config(data_dir / "config.json")
    try:
        pg = LocalPostgres(find_bin_dir(app_dir()), data_dir, cfg.get("pg_password"))
        print("Starting the database…")
        pg.start(cfg.get("pg_port"))
        cfg.set(pg_port=pg.port)
        pg.ensure(LIVE_DB)
    except PostgresError as err:
        print(f"\n{err}\n")
        if IS_WINDOWS:
            input("Press Enter to close.")
        raise SystemExit(1) from err

    _stop_on_console_close(pg)
    web_port = free_port(cfg.get("web_port", DEFAULT_WEB_PORT))
    cfg.set(web_port=web_port)
    configure_environment(data_dir, cfg, pg, web_port)
    try:
        print("Bringing the database up to this version of the app…")
        migrate()

        import uvicorn

        from prs_standalone.web import build_app

        server = uvicorn.Server(
            uvicorn.Config(build_app(frontend_dir(), pg), host="127.0.0.1", port=web_port, log_level="warning")
        )
        url = f"http://127.0.0.1:{web_port}"

        def open_when_up() -> None:
            while not server.started:
                time.sleep(0.1)
            (data_dir / "running.json").write_text(json.dumps({"port": web_port, "pid": os.getpid()}))
            print(f"PRS is running at {url} — keep this window open while you use it; close it to stop.")
            if not os.environ.get("PRS_NO_BROWSER"):
                webbrowser.open(url)

        threading.Thread(target=open_when_up, daemon=True).start()
        server.run()
    finally:
        (data_dir / "running.json").unlink(missing_ok=True)
        print("Stopping the database…")
        pg.stop()


if __name__ == "__main__":
    main()
