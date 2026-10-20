#!/usr/bin/env python3
"""Deliberate, operator-run restore. Overwrites the target database, so it
requires explicitly confirming the target database name as a safety check.

Before overwriting anything it takes a "before-restore" backup of the live
database, so a restore of the wrong file can itself be undone. It then
empties the database and restores the backup into it, and upgrades it to
this version of the app — so a backup from before later changes restores
too, and is usable straight away.

Usage:
    python scripts/restore_db.py /path/to/emitterdb_20260101_030000.dump --confirm-db rf_emitter_db
    python scripts/restore_db.py ... --no-safety-backup   # skip that (e.g. the live database is broken)
"""

import argparse
import os
import subprocess
import sys
from urllib.parse import urlparse

from sqlalchemy import create_engine, text

sys.path.insert(0, ".")

from app.config import settings  # noqa: E402
from app.services.backup_service import BackupError, run_pg_restore, take_backup  # noqa: E402


def _empty_database(database_url: str) -> None:
    """Drop everything in the database's public schema first. A backup from
    before a later migration doesn't hold the tables added since, and those
    still point at its tables (e.g. users) — `pg_restore --clean` only drops
    what's in the dump, so it fails on them ("cannot drop constraint
    users_pkey … other objects depend on it"). The live database was backed
    up first, so nothing is lost."""
    engine = create_engine(database_url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as conn:
            conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
            conn.execute(text("CREATE SCHEMA public"))
    finally:
        engine.dispose()


def _upgrade_schema() -> None:
    """Bring a restored older backup up to this version of the app."""
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    result = subprocess.run(["alembic", "upgrade", "head"], cwd=backend_dir, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Restored, but the database couldn't be upgraded: {result.stderr.strip()[-500:]}")
    print("Database upgraded to this version of the app (alembic upgrade head).")


def restore(dump_path: str, database_url: str) -> None:
    parsed = urlparse(database_url.replace("+psycopg2", ""))
    _empty_database(database_url)
    args = ["pg_restore", "--no-owner"]
    if parsed.hostname:
        args += ["-h", parsed.hostname]
    if parsed.port:
        args += ["-p", str(parsed.port)]
    if parsed.username:
        args += ["-U", parsed.username]
    if parsed.path.lstrip("/"):
        args += ["-d", parsed.path.lstrip("/")]
    args.append(dump_path)

    env = dict(os.environ)
    if parsed.password:
        env["PGPASSWORD"] = parsed.password

    ok, problem, skipped = run_pg_restore(args, env)
    if not ok:
        raise RuntimeError(f"pg_restore failed: {problem}")
    if skipped:
        print(f"Skipped {skipped} setting(s) this Postgres server doesn't know (harmless).")
    print(f"Restored {dump_path} into database '{parsed.path.lstrip('/')}'.")
    _upgrade_schema()


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
    args = parser.parse_args()

    parsed = urlparse(settings.database_url.replace("+psycopg2", ""))
    actual_db = parsed.path.lstrip("/")
    if args.confirm_db != actual_db:
        print(
            f"Refusing to restore: --confirm-db '{args.confirm_db}' does not match the configured "
            f"database '{actual_db}'.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    if not os.path.isfile(args.dump_path):
        print(f"Dump file not found: {args.dump_path}", file=sys.stderr)
        raise SystemExit(1)

    if not args.no_safety_backup:
        try:
            safety = take_backup(kind="before-restore", created_by="restore_db.py")
        except BackupError as err:
            print(
                f"Refusing to restore: couldn't back up the live database first ({err}). "
                "Fix that, or pass --no-safety-backup if the live database can't be saved.",
                file=sys.stderr,
            )
            raise SystemExit(1)
        print(f"Live database backed up first: {safety['file']}")

    restore(args.dump_path, settings.database_url)


if __name__ == "__main__":
    main()
