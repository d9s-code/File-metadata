#!/usr/bin/env python3
"""The backup container's main loop — runs apart from the web app, so backups
happen whether or not the app is up. Every night at BACKUP_SCHEDULE_TIME (the
container's clock, UTC) it:

1. takes a backup (dump + manifest; copied to BACKUP_COPY_DIR if set),
2. restores it into the scratch database to check it,
3. prunes old backups (BACKUP_RETENTION_DAILY / _WEEKLY / _MONTHLY),
4. purges Recently Deleted items past TRASH_RETENTION_DAYS.

On start it also takes a backup straight away if the latest is older than
BACKUP_MAX_AGE_HOURS, so a server that was down overnight catches up. What it
did last, and when it runs next, goes to scheduler.json in the backup directory
— the Admin → Backups page reads it.

Usage:
    python scripts/backup_scheduler.py            # run forever
    python scripts/backup_scheduler.py --once     # one run now, then exit
"""

import argparse
import sys
import time
import traceback
from datetime import datetime, timedelta, timezone

sys.path.insert(0, ".")

from app.config import settings  # noqa: E402
from app.services.backup_service import (  # noqa: E402
    BackupError,
    list_backups,
    prune_backups,
    scheduler_status,
    take_backup,
    verify_backup,
    write_scheduler_status,
)
from app.services.trash_service import purge_expired  # noqa: E402


def _next_run(now: datetime) -> datetime:
    hour, minute = (int(x) for x in settings.backup_schedule_time.split(":"))
    run = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return run if run > now else run + timedelta(days=1)


def _log(message: str) -> None:
    print(f"{datetime.now(timezone.utc).isoformat(timespec='seconds')} {message}", flush=True)


def run_once() -> dict:
    """One full run; returns what happened (also written to scheduler.json)."""
    started = datetime.now(timezone.utc)
    result: dict = {"last_run_at": started.isoformat(), "last_error": None}
    steps = []
    try:
        manifest = take_backup(kind="scheduled", created_by="scheduler")
        steps.append(f"backed up to {manifest['file']} ({manifest['size_bytes']:,} bytes)")
        if settings.backup_copy_dir and not manifest.get("copied_to"):
            steps.append(f"COULD NOT copy it to {settings.backup_copy_dir}")
            result["last_error"] = f"The copy to {settings.backup_copy_dir} failed"
        try:
            check = verify_backup(manifest["file"])["verification"]
            steps.append(f"verification {'passed' if check['ok'] else 'FAILED'}: {check['message']}")
            if not check["ok"]:
                result["last_error"] = f"Verification failed: {check['message']}"
        except BackupError as err:
            steps.append(f"not verified: {err}")
            result["last_error"] = result["last_error"] or f"Not verified: {err}"
        removed = prune_backups()
        if removed:
            steps.append(f"pruned {len(removed)} old backup(s)")
        purged = purge_expired()
        if purged:
            steps.append(f"purged {purged} item(s) from Recently Deleted")
    except Exception as err:  # anything at all — the loop must keep going
        result["last_error"] = str(err) or err.__class__.__name__
        steps.append(f"FAILED: {result['last_error']}")
        traceback.print_exc()
    result["last_steps"] = steps
    result["finished_at"] = datetime.now(timezone.utc).isoformat()
    for step in steps:
        _log(step)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()

    if args.once:
        status = run_once()
        write_scheduler_status({**(scheduler_status() or {}), **status, "next_run_at": None})
        raise SystemExit(1 if status["last_error"] else 0)

    _log(f"Backup scheduler started — nightly at {settings.backup_schedule_time} UTC, into {settings.backup_dir}")
    status = scheduler_status() or {}
    backups = list_backups()
    stale = not backups or datetime.now(timezone.utc) - backups[0].when > timedelta(hours=settings.backup_max_age_hours)
    if stale:
        _log("The latest backup is missing or too old — taking one now")
        status.update(run_once())
    while True:
        now = datetime.now(timezone.utc)
        upcoming = _next_run(now)
        status.update({"next_run_at": upcoming.isoformat(), "heartbeat_at": now.isoformat()})
        write_scheduler_status(status)
        # Wake every minute to keep the heartbeat fresh, until it's time.
        while datetime.now(timezone.utc) < upcoming:
            time.sleep(min(60, max(1, (upcoming - datetime.now(timezone.utc)).total_seconds())))
            status["heartbeat_at"] = datetime.now(timezone.utc).isoformat()
            write_scheduler_status(status)
        status.update(run_once())


if __name__ == "__main__":
    main()
