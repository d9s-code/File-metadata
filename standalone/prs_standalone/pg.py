"""The PostgreSQL server the standalone app runs on: its own, from the
binaries shipped beside the app, in a folder under the user's data folder.

It listens on 127.0.0.1 only, on a free port picked at each start, with a
password generated at the first start — nothing outside this PC can reach it.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

IS_WINDOWS = os.name == "nt"
EXE = ".exe" if IS_WINDOWS else ""
SUPERUSER = "prs"


class PostgresError(RuntimeError):
    """Postgres couldn't be set up or started — the message says why, for a person."""


def find_bin_dir(app_dir: Path) -> Path:
    """Where initdb, pg_ctl, pg_dump and pg_restore are: beside the app
    (pgsql/bin, as the Windows build ships them), PRS_PG_BIN, or — when run
    from source on Linux — the system's PostgreSQL."""
    candidates = []
    if os.environ.get("PRS_PG_BIN"):
        candidates.append(Path(os.environ["PRS_PG_BIN"]))
    candidates.append(app_dir / "pgsql" / "bin")
    if not IS_WINDOWS:
        candidates += sorted(Path("/usr/lib/postgresql").glob("*/bin"), reverse=True)
    for path in candidates:
        if (path / f"pg_ctl{EXE}").is_file() and (path / f"initdb{EXE}").is_file():
            return path
    raise PostgresError(
        "PostgreSQL isn't included with this copy of the app (no pgsql\\bin folder beside it). "
        "Use the full download, or set PRS_PG_BIN to a PostgreSQL bin folder."
    )


def free_port(preferred: int | None = None) -> int:
    for port in ([preferred] if preferred else []) + [0]:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
            except OSError:
                continue
            return s.getsockname()[1]
    raise PostgresError("No free network port on this PC")


def _run(args: list[str], **kwargs) -> subprocess.CompletedProcess:
    # No console window flashing up on Windows for each tool run.
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return subprocess.run(args, capture_output=True, text=True, creationflags=flags, **kwargs)


class LocalPostgres:
    def __init__(self, bin_dir: Path, data_dir: Path, password: str):
        self.bin_dir = bin_dir
        self.cluster = data_dir / "pgdata"
        self.log = data_dir / "postgres.log"
        self.password = password
        self.port: int | None = None

    def tool(self, name: str) -> str:
        return str(self.bin_dir / f"{name}{EXE}")

    def env(self) -> dict:
        return {**os.environ, "PGPASSWORD": self.password}

    def url(self, database: str) -> str:
        return f"postgresql+psycopg2://{SUPERUSER}:{self.password}@127.0.0.1:{self.port}/{database}"

    def client_args(self) -> list[str]:
        return ["-h", "127.0.0.1", "-p", str(self.port), "-U", SUPERUSER]

    def initialised(self) -> bool:
        return (self.cluster / "PG_VERSION").is_file()

    def init(self) -> None:
        """Creates the cluster, the first time the app runs on this PC."""
        self.cluster.parent.mkdir(parents=True, exist_ok=True)
        if self.cluster.exists():
            shutil.rmtree(self.cluster)  # a first start that stopped half-way
        pwfile = self.cluster.parent / "pg.pw"
        pwfile.write_text(self.password, encoding="utf-8")
        try:
            result = _run(
                [
                    self.tool("initdb"),
                    "-D", str(self.cluster),
                    "-U", SUPERUSER,
                    "--pwfile", str(pwfile),
                    "--auth", "scram-sha-256",
                    "--encoding", "UTF8",
                    "--locale", "C",
                ]
            )
        finally:
            pwfile.unlink(missing_ok=True)
        if result.returncode != 0:
            raise PostgresError(f"Couldn't create the database folder: {result.stderr.strip()[-400:]}")

    def start(self, preferred_port: int | None = None) -> None:
        if not self.initialised():
            self.init()
        self._stop_leftover()
        self.port = free_port(preferred_port)
        options = f"-p {self.port} -c listen_addresses=127.0.0.1"
        if not IS_WINDOWS:
            options += " -c unix_socket_directories=''"
        result = _run(
            [self.tool("pg_ctl"), "start", "-D", str(self.cluster), "-l", str(self.log), "-w", "-t", "60", "-o", options]
        )
        if result.returncode != 0:
            tail = self.log.read_text(errors="replace")[-600:] if self.log.exists() else result.stderr
            raise PostgresError(f"The database didn't start: {tail.strip()}")
        self._wait_ready()

    def _stop_leftover(self) -> None:
        """A server left running by an app that was killed: stop it, so this start owns the folder."""
        if (self.cluster / "postmaster.pid").exists():
            _run([self.tool("pg_ctl"), "stop", "-D", str(self.cluster), "-m", "fast", "-w", "-t", "30"])

    def _wait_ready(self) -> None:
        import psycopg2

        deadline = time.monotonic() + 30
        while True:
            try:
                psycopg2.connect(
                    host="127.0.0.1", port=self.port, user=SUPERUSER, password=self.password, dbname="postgres"
                ).close()
                return
            except psycopg2.OperationalError as err:
                if time.monotonic() > deadline:
                    raise PostgresError(f"The database started but doesn't answer: {err}") from err
                time.sleep(0.3)

    def stop(self) -> None:
        if self.initialised():
            _run([self.tool("pg_ctl"), "stop", "-D", str(self.cluster), "-m", "fast", "-w", "-t", "30"])

    # --- Databases -----------------------------------------------------------

    def _admin(self):
        import psycopg2

        conn = psycopg2.connect(
            host="127.0.0.1", port=self.port, user=SUPERUSER, password=self.password, dbname="postgres"
        )
        conn.autocommit = True
        return conn

    def exists(self, database: str) -> bool:
        conn = self._admin()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (database,))
                return cur.fetchone() is not None
        finally:
            conn.close()

    def create(self, database: str) -> None:
        conn = self._admin()
        try:
            with conn.cursor() as cur:
                cur.execute(f'CREATE DATABASE "{database}"')
        finally:
            conn.close()

    def drop(self, database: str) -> None:
        conn = self._admin()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %s AND pid <> pg_backend_pid()",
                    (database,),
                )
                cur.execute(f'DROP DATABASE IF EXISTS "{database}"')
        finally:
            conn.close()

    def ensure(self, database: str) -> None:
        if not self.exists(database):
            self.create(database)

    def restore(self, dump: Path, database: str) -> None:
        """Replaces `database` with the contents of a pg_dump custom-format file."""
        self.drop(database)
        self.create(database)
        result = _run(
            [self.tool("pg_restore"), *self.client_args(), "-d", database, "--no-owner", "--no-privileges", str(dump)],
            env=self.env(),
        )
        # pg_restore reports harmless warnings (e.g. a server-only role) with exit code 1; a
        # restore with real errors leaves the tables missing, which the caller checks.
        if result.returncode not in (0, 1):
            raise PostgresError(f"Couldn't load the copy: {result.stderr.strip()[-400:]}")

    def dump(self, database: str, target: Path) -> None:
        result = _run([self.tool("pg_dump"), *self.client_args(), "-Fc", "-f", str(target), database], env=self.env())
        if result.returncode != 0:
            raise PostgresError(f"Couldn't copy the database: {result.stderr.strip()[-400:]}")


def default_data_dir() -> Path:
    if os.environ.get("PRS_DATA_DIR"):
        return Path(os.environ["PRS_DATA_DIR"])
    if IS_WINDOWS:
        return Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "PRS"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "prs-standalone"


def app_dir() -> Path:
    """The folder the app was started from: beside PRS.exe when frozen, the repo when run from source."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent
