#!/usr/bin/env python3
"""Deliberate, operator-run restore. Overwrites the target database, so it
requires explicitly confirming the target database name as a safety check.

Before overwriting anything it takes a "before-restore" backup of the live
database, so a restore of the wrong file can itself be undone.

Usage:
    python scripts/restore_db.py /path/to/emitterdb_20260101_030000.dump --confirm-db rf_emitter_db
    python scripts/restore_db.py ... --no-safety-backup   # skip that (e.g. the live database is broken)
"""

import argparse
import os
import sys
from urllib.parse import urlparse

sys.path.insert(0, ".")

from app.config import settings  # noqa: E402
from app.services.backup_service import BackupError, run_pg_restore, take_backup  # noqa: E402


def restore(dump_path: str, database_url: str) -> None:
    parsed = urlparse(database_url.replace("+psycopg2", ""))
    args = ["pg_restore", "--clean", "--if-exists", "--no-owner"]
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
