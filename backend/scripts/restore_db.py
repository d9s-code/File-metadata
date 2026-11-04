#!/usr/bin/env python3
"""Deliberate, operator-run restore. Overwrites the target database, so it
requires explicitly confirming the target database name as a safety check.

It checks everything it can before touching the database:

1. the file is whole — its checksum matches the record written with it, and
   pg_restore can read all of it;
2. it's from this version of the app or an older one (a newer backup can't be
   brought down to this version);
3. nothing is busy writing to the database (stop the app first).

Then it takes a "before-restore" backup of the live database (skipped when it's
empty, as on a new server), so a restore of the wrong file can itself be undone,
and restores in a single transaction: the old contents are replaced all at once,
or — if anything goes wrong — left exactly as they were. Finally it checks the
restored row counts against the backup's record and upgrades the database to
this version of the app, so a backup from before later changes is usable
straight away.

Usage:
    python scripts/restore_db.py /path/to/emitterdb_20260101_030000.dump --confirm-db rf_emitter_db
    python scripts/restore_db.py ... --no-safety-backup   # skip that (e.g. the live database is broken)
    python scripts/restore_db.py ... --ignore-connections # restore although something else is using it
    python scripts/restore_db.py ... --ignore-checksum    # restore a file whose checksum doesn't match
"""

import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

sys.path.insert(0, ".")

from app.config import settings  # noqa: E402
from app.services.backup_service import (  # noqa: E402
    BackupError,
    _sha256,
    read_manifest,
    table_counts,
    take_backup,
)

BACKEND_DIR = Path(__file__).resolve().parent.parent

#: Lines pg_restore writes that only tune its own session and that an older
#: server may not know (transaction_timeout is Postgres 17+): left out, so the
#: one-transaction restore doesn't stop on them.
_SKIPPED_SETTINGS = ("SET transaction_timeout",)


class RestoreError(Exception):
    """The restore can't go ahead, or didn't work — the message says why, for a person."""


def _client(tool: str, database_url: str) -> tuple[list[str], dict]:
    parsed = urlparse(database_url.replace("+psycopg2", ""))
    args = [tool]
    if parsed.hostname:
        args += ["-h", parsed.hostname]
    if parsed.port:
        args += ["-p", str(parsed.port)]
    if parsed.username:
        args += ["-U", parsed.username]
    env = dict(os.environ)
    if parsed.password:
        env["PGPASSWORD"] = parsed.password
    return args, env


def check_checksum(dump: Path, manifest: dict | None, ignore: bool) -> None:
    if not manifest or not manifest.get("sha256"):
        print("No checksum recorded for this file — it's checked by reading it in full instead.")
        return
    if _sha256(dump) == manifest["sha256"]:
        print("Checksum matches the backup's record.")
        return
    if ignore:
        print("WARNING: the checksum doesn't match the backup's record — restoring anyway (--ignore-checksum).")
        return
    raise RestoreError(
        "The file has changed since the backup was written — its checksum doesn't match. "
        "Use another backup, or pass --ignore-checksum to restore it anyway."
    )


def check_app_version(manifest: dict | None) -> None:
    """A backup from a newer version of the app can't be upgraded by this one."""
    revision = (manifest or {}).get("alembic_version")
    if not revision:
        return
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from alembic.util import CommandError

    script = ScriptDirectory.from_config(Config(str(BACKEND_DIR / "alembic.ini")))
    try:
        script.get_revision(revision)
    except CommandError as err:
        raise RestoreError(
            f"This backup is from a newer version of the app (database version {revision}, which this "
            "version doesn't know). Restore it with that version of the app, or newer."
        ) from err


def write_restore_script(dump: Path, target: Path, schema: str = "public") -> None:
    """The whole backup as SQL, read in full first — a damaged or cut-off file fails
    here, before the database is touched. It replaces `schema`, the one the backup
    holds."""
    result = subprocess.run(
        ["pg_restore", "--no-owner", "--no-privileges", "-f", "-", str(dump)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        detail = result.stderr.decode(errors="replace").strip().splitlines()
        raise RestoreError(f"The backup file can't be read in full: {detail[-1] if detail else 'pg_restore failed'}")
    lines = result.stdout.splitlines(keepends=True)
    # A dump of one named schema creates it; a whole-database dump leaves public to the database.
    creates = any(line.startswith(f"CREATE SCHEMA {schema};".encode()) for line in lines)
    with open(target, "wb") as out:
        # Replace the schema wholesale: a backup from before a later migration doesn't
        # hold the tables added since, and those still point at its tables. Wait at most
        # 30 seconds for anything still using the tables, rather than hang.
        out.write(f"SET lock_timeout = '30s';\nDROP SCHEMA IF EXISTS \"{schema}\" CASCADE;\n".encode())
        if not creates:
            out.write(f"CREATE SCHEMA \"{schema}\";\n".encode())
        for line in lines:
            if not line.startswith(tuple(s.encode() for s in _SKIPPED_SETTINGS)):
                out.write(line)


def other_connections(database_url: str) -> tuple[int, int]:
    """(busy, idle): other sessions on the database — busy ones are running a query
    or are inside a transaction."""
    engine = create_engine(database_url, poolclass=NullPool)
    try:
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT state FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()"
                )
            ).scalars().all()
    finally:
        engine.dispose()
    busy = sum(1 for s in rows if s and s != "idle")
    return busy, len(rows) - busy


def database_is_empty(database_url: str, schema: str = "public") -> bool:
    engine = create_engine(database_url, poolclass=NullPool)
    try:
        with engine.connect() as conn:
            return not conn.execute(
                text("SELECT count(*) FROM pg_tables WHERE schemaname = :schema"), {"schema": schema}
            ).scalar_one()
    finally:
        engine.dispose()


def run_restore_script(script: Path, database_url: str) -> None:
    parsed = urlparse(database_url.replace("+psycopg2", ""))
    args, env = _client("psql", database_url)
    args += ["-X", "-q", "--single-transaction", "-v", "ON_ERROR_STOP=1", "-d", parsed.path.lstrip("/"), "-f", str(script)]
    result = subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env=env)
    if result.returncode != 0:
        lines = result.stderr.decode(errors="replace").strip().splitlines()
        errors = [line.split("ERROR:", 1)[1].strip() for line in lines if "ERROR:" in line]
        problem = errors[0] if errors else (lines[-1] if lines else f"psql exit code {result.returncode}")
        if "lock timeout" in problem:
            problem += " — something is still using the database; stop the app and try again"
        raise RestoreError(f"The restore didn't go through, and the database is unchanged: {problem}")


def check_counts(manifest: dict | None, database_url: str, schema: str = "public") -> None:
    expected = (manifest or {}).get("counts")
    if not expected:
        return
    engine = create_engine(database_url, poolclass=NullPool)
    try:
        with engine.connect() as conn:
            conn.execute(text(f'SET search_path TO "{schema}"'))
            counts = table_counts(conn)
    finally:
        engine.dispose()
    wrong = [f"{t}: {counts.get(t, 'missing')} rows, expected {n}" for t, n in expected.items() if counts.get(t) != n]
    if wrong:
        print("WARNING: the restored row counts differ from the backup's record — " + "; ".join(wrong[:5]))
    else:
        print(f"Checked {len(counts)} tables, {sum(counts.values()):,} rows — they match the backup's record.")


def upgrade_schema(database_url: str) -> None:
    """Bring a restored older backup up to this version of the app — the database
    just restored, whatever the environment otherwise points at."""
    env = {**os.environ, "DATABASE_URL": database_url}
    result = subprocess.run(["alembic", "upgrade", "head"], cwd=BACKEND_DIR, capture_output=True, text=True, env=env)
    if result.returncode != 0:
        raise RestoreError(
            "Restored, but the database couldn't be upgraded to this version of the app: "
            f"{result.stderr.strip()[-500:]}. Run `alembic upgrade head` once the cause is fixed."
        )
    print("Database upgraded to this version of the app (alembic upgrade head).")


def restore(
    dump: Path,
    database_url: str,
    *,
    safety_backup: bool = True,
    ignore_connections: bool = False,
    ignore_checksum: bool = False,
    upgrade: bool = True,
) -> None:
    manifest = read_manifest(dump)
    check_checksum(dump, manifest, ignore_checksum)
    check_app_version(manifest)
    database = urlparse(database_url.replace("+psycopg2", "")).path.lstrip("/")
    schema = (manifest or {}).get("schema") or "public"

    with tempfile.TemporaryDirectory(prefix="restore-") as tmp:
        script = Path(tmp) / "restore.sql"
        write_restore_script(dump, script, schema)
        print("The backup file reads in full.")

        busy, idle = other_connections(database_url)
        if busy and not ignore_connections:
            raise RestoreError(
                f"{busy} other connection(s) are busy on '{database}' — stop the app first "
                "(or pass --ignore-connections)."
            )
        if busy or idle:
            print(f"Note: {busy + idle} other connection(s) to '{database}' are open; stop the app before restoring.")

        if not safety_backup:
            print("Not backing up the live database first (--no-safety-backup).")
        elif database_is_empty(database_url, schema):
            print(f"'{database}' is empty — nothing to back up first.")
        else:
            try:
                safety = take_backup(kind="before-restore", created_by="restore_db.py")
            except BackupError as err:
                raise RestoreError(
                    f"Couldn't back up the live database first ({err}). Fix that, or pass "
                    "--no-safety-backup if the live database can't be saved."
                ) from err
            print(f"Live database backed up first: {safety['file']} — restore that to undo this.")

        run_restore_script(script, database_url)
    print(f"Restored {dump} into database '{database}'.")
    check_counts(manifest, database_url, schema)
    if upgrade:
        upgrade_schema(database_url)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("dump_path", help="Path to a .dump file produced by backup_db.py")
    parser.add_argument(
        "--confirm-db",
        required=True,
        help="Must exactly match the database name in DATABASE_URL, as a guard against restoring "
        "into the wrong environment.",
    )
    parser.add_argument(
        "--no-safety-backup",
        action="store_true",
        help="Don't back up the live database first (only if it can't be backed up, e.g. it's broken).",
    )
    parser.add_argument(
        "--ignore-connections",
        action="store_true",
        help="Restore even though other connections are busy on the database.",
    )
    parser.add_argument(
        "--ignore-checksum",
        action="store_true",
        help="Restore a file whose checksum doesn't match the backup's record.",
    )
    args = parser.parse_args()

    actual_db = urlparse(settings.database_url.replace("+psycopg2", "")).path.lstrip("/")
    if args.confirm_db != actual_db:
        print(
            f"Refusing to restore: --confirm-db '{args.confirm_db}' does not match the configured "
            f"database '{actual_db}'.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    dump = Path(args.dump_path)
    if not dump.is_file():
        print(f"Dump file not found: {dump}", file=sys.stderr)
        raise SystemExit(1)

    try:
        restore(
            dump,
            settings.database_url,
            safety_backup=not args.no_safety_backup,
            ignore_connections=args.ignore_connections,
            ignore_checksum=args.ignore_checksum,
        )
    except RestoreError as err:
        print(str(err), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
