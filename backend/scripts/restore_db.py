#!/usr/bin/env python3
"""Deliberate, operator-run restore. Overwrites the target database, so it
requires explicitly confirming the target database name as a safety check.

Usage:
    python scripts/restore_db.py /path/to/emitterdb_20260101_030000.dump --confirm-db rf_emitter_db
"""

import argparse
import os
import subprocess
import sys
from urllib.parse import urlparse

sys.path.insert(0, ".")

from app.config import settings  # noqa: E402


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

    result = subprocess.run(args, env=env)
    if result.returncode != 0:
        raise RuntimeError(f"pg_restore failed with exit code {result.returncode}")
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

    restore(args.dump_path, settings.database_url)


if __name__ == "__main__":
    main()
