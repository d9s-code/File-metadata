#!/usr/bin/env python3
"""Whole-database backup via pg_dump, meant to be run from OS cron/systemd
(decoupled from whether the FastAPI app is up), or on demand.

Usage:
    python scripts/backup_db.py                 # take a backup + prune old ones
    python scripts/backup_db.py --no-prune       # take a backup only
    python scripts/backup_db.py --prune-only     # just apply retention policy
"""

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, ".")

from app.config import settings  # noqa: E402

FILENAME_RE = re.compile(r"^emitterdb_(\d{8})_(\d{6})\.dump$")


def _pg_dump_args_from_url(database_url: str) -> list[str]:
    # database_url looks like postgresql+psycopg2://user:pass@host:port/dbname
    parsed = urlparse(database_url.replace("+psycopg2", ""))
    args = ["pg_dump", "-Fc"]
    if parsed.hostname:
        args += ["-h", parsed.hostname]
    if parsed.port:
        args += ["-p", str(parsed.port)]
    if parsed.username:
        args += ["-U", parsed.username]
    args.append(parsed.path.lstrip("/"))
    return args


def take_backup(backup_dir: Path) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    out_path = backup_dir / f"emitterdb_{timestamp}.dump"

    args = _pg_dump_args_from_url(settings.database_url)
    parsed = urlparse(settings.database_url.replace("+psycopg2", ""))
    env = {}
    if parsed.password:
        import os

        env = dict(os.environ)
        env["PGPASSWORD"] = parsed.password

    with open(out_path, "wb") as f:
        result = subprocess.run(args, stdout=f, env=env or None)
    if result.returncode != 0:
        out_path.unlink(missing_ok=True)
        raise RuntimeError(f"pg_dump failed with exit code {result.returncode}")

    print(f"Backup written: {out_path}")
    return out_path


@dataclass
class _Dump:
    path: Path
    when: datetime


def _list_dumps(backup_dir: Path) -> list[_Dump]:
    dumps = []
    if not backup_dir.exists():
        return dumps
    for p in backup_dir.glob("emitterdb_*.dump"):
        m = FILENAME_RE.match(p.name)
        if not m:
            continue
        when = datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
        dumps.append(_Dump(path=p, when=when))
    return sorted(dumps, key=lambda d: d.when, reverse=True)


def prune_backups(
    backup_dir: Path,
    keep_daily: int = 14,
    keep_weekly: int = 8,
    keep_monthly: int = 6,
) -> list[Path]:
    """Keep the newest `keep_daily` dumps outright, then thin older ones down
    to roughly one-per-week for `keep_weekly` weeks and one-per-month for
    `keep_monthly` months; delete everything else. Returns paths removed.
    """
    dumps = _list_dumps(backup_dir)
    keep: set[Path] = set(d.path for d in dumps[:keep_daily])

    older = dumps[keep_daily:]
    seen_weeks: set[tuple[int, int]] = set()
    remaining_after_weekly = []
    for d in older:
        iso_year, iso_week, _ = d.when.isocalendar()
        key = (iso_year, iso_week)
        if key not in seen_weeks and len(seen_weeks) < keep_weekly:
            seen_weeks.add(key)
            keep.add(d.path)
        else:
            remaining_after_weekly.append(d)

    seen_months: set[tuple[int, int]] = set()
    for d in remaining_after_weekly:
        key = (d.when.year, d.when.month)
        if key not in seen_months and len(seen_months) < keep_monthly:
            seen_months.add(key)
            keep.add(d.path)

    removed = []
    for d in dumps:
        if d.path not in keep:
            d.path.unlink(missing_ok=True)
            removed.append(d.path)
            print(f"Pruned: {d.path}")
    return removed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-prune", action="store_true")
    parser.add_argument("--prune-only", action="store_true")
    parser.add_argument("--backup-dir", default=settings.backup_dir)
    args = parser.parse_args()

    backup_dir = Path(args.backup_dir)
    if not args.prune_only:
        take_backup(backup_dir)
    if not args.no_prune:
        prune_backups(
            backup_dir,
            keep_daily=settings.backup_retention_daily,
            keep_weekly=settings.backup_retention_weekly,
            keep_monthly=settings.backup_retention_monthly,
        )


if __name__ == "__main__":
    main()
