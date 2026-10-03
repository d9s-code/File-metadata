#!/usr/bin/env python3
"""The backup container's main loop — runs apart from the web app, so backups
happen whether or not the app is up. Every BACKUP_SCHEDULE_DAY (a weekday, or
"daily"; default Sunday) at BACKUP_SCHEDULE_TIME (the container's clock, UTC) it:

1. takes a backup (dump + manifest; copied to BACKUP_COPY_DIR if set),
2. restores it into the scratch database to check it,
3. prunes old backups (BACKUP_RETENTION_DAILY / _WEEKLY / _MONTHLY).

Every day at that time it also purges Recently Deleted items past
TRASH_RETENTION_DAYS, so nothing outstays its countdown by more than a day.

On start it takes a backup straight away if the latest is older than one
schedule interval (and a bit), so a server that was down catches up. What it
did last, and when it backs up next, goes to scheduler.json in the backup
directory — the Admin → Backups page reads it.

Between automatic backups the app shows how much has changed since the last one,
and asks admins for a backup sooner the more there is (BACKUP_CHANGES_PER_WEEK).

Usage:
    python scripts/backup_scheduler.py            # run forever
    python scripts/backup_scheduler.py --once     # one backup run now, then exit
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
    next_scheduled_backup,
    prune_backups,
    schedule_interval,
    schedule_label,
    schedule_weekday,
    scheduler_status,
    take_backup,
    verify_backup,
    write_scheduler_status,
)
from app.services.trash_service import purge_expired  # noqa: E402


def _next_tick(now: datetime) -> datetime:
    """The next daily run time — housekeeping every day, a backup on backup days."""
    hour, minute = (int(x) for x in settings.backup_schedule_time.split(":"))
    run = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return run if run > now else run + timedelta(days=1)


def _is_backup_day(when: datetime) -> bool:
    weekday = schedule_weekday()
    return weekday is None or when.weekday() == weekday


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
    except Exception as err:  # anything at all — the loop must keep going
        result["last_error"] = str(err) or err.__class__.__name__
        steps.append(f"FAILED: {result['last_error']}")
        traceback.print_exc()
    result["last_steps"] = steps
    result["finished_at"] = datetime.now(timezone.utc).isoformat()
    for step in steps:
        _log(step)
    return result


def purge_trash() -> dict:
    """The daily housekeeping: Recently Deleted items past their time go for good."""
    try:
        purged = purge_expired()
        if purged:
            _log(f"purged {purged} item(s) from Recently Deleted")
        return {"last_purge_at": datetime.now(timezone.utc).isoformat(), "last_purge_error": None}
    except Exception as err:  # the loop must keep going
        traceback.print_exc()
        return {"last_purge_error": str(err) or err.__class__.__name__}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()

    if args.once:
        status = {**run_once(), **purge_trash()}
        write_scheduler_status({**(scheduler_status() or {}), **status, "next_run_at": None})
        raise SystemExit(1 if status["last_error"] else 0)

    schedule_weekday()  # a bad BACKUP_SCHEDULE_DAY stops the container here, loudly
    _log(f"Backup scheduler started — {schedule_label()}, into {settings.backup_dir}")
    status = scheduler_status() or {}
    backups = list_backups()
    stale = not backups or datetime.now(timezone.utc) - backups[0].when > schedule_interval() + timedelta(hours=6)
    if stale:
        _log("The latest backup is missing or older than the schedule allows — taking one now")
        status.update(run_once())
    while True:
        now = datetime.now(timezone.utc)
        tick = _next_tick(now)
        status.update({"next_run_at": next_scheduled_backup(now).isoformat(), "heartbeat_at": now.isoformat()})
        write_scheduler_status(status)
        # Wake every minute to keep the heartbeat fresh, until it's time.
        while datetime.now(timezone.utc) < tick:
            time.sleep(min(60, max(1, (tick - datetime.now(timezone.utc)).total_seconds())))
            status["heartbeat_at"] = datetime.now(timezone.utc).isoformat()
            write_scheduler_status(status)
        if _is_backup_day(tick):
            status.update(run_once())
        status.update(purge_trash())


if __name__ == "__main__":
    main()
