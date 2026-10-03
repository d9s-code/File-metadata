#!/usr/bin/env python3
"""Whole-database backup: a pg_dump file plus its manifest (checksum, row
counts and an overview of every Emitter, Platform and MDF — see
app/services/backup_service.py). The backup scheduler container runs this
nightly; run it by hand for a one-off.

Usage:
    python scripts/backup_db.py                 # take a backup + prune old ones
    python scripts/backup_db.py --no-prune      # take a backup only
    python scripts/backup_db.py --prune-only    # just apply the retention policy
    python scripts/backup_db.py --verify        # also restore it into the scratch database to check it
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, ".")

from app.config import settings  # noqa: E402
from app.services.backup_service import BackupError, prune_backups, take_backup, verify_backup  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-prune", action="store_true")
    parser.add_argument("--prune-only", action="store_true")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--backup-dir", default=settings.backup_dir)
    args = parser.parse_args()

    directory = Path(args.backup_dir)
    try:
        if not args.prune_only:
            manifest = take_backup(kind="manual", created_by="command line", directory=directory)
            print(f"Backup written: {directory / manifest['file']} ({manifest['size_bytes']:,} bytes)")
            if args.verify:
                result = verify_backup(manifest["file"], directory)["verification"]
                print(f"Verification {'passed' if result['ok'] else 'FAILED'}: {result['message']}")
                if not result["ok"]:
                    raise SystemExit(2)
        if not args.no_prune:
            for path in prune_backups(directory):
                print(f"Pruned: {path}")
    except BackupError as err:
        print(f"Backup failed: {err}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
