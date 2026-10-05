"""Whole-database backups: taking them, keeping a record of each, checking
they restore, and comparing what they hold.

Every backup is a `pg_dump` custom-format file plus a manifest beside it
(same name, `.json`): when and how it was made, its size and SHA-256, the row
count of every table, and an *overview* — each Emitter, Platform and MDF with
its name, status, Mode count, latest saved version and pins. The dump and the
overview come from one exported database snapshot, so they always agree.
Comparing two backups (or a backup with the live data) compares overviews, so
nothing has to be restored to see what changed between them.

Verification restores a dump into a separate scratch database, checks every
table's row count against the manifest, then empties the scratch database
again. A backup made before manifests existed gets its overview and counts
filled in from that restore.

Used by the Admin → Backups page, the backup scheduler container
(scripts/backup_scheduler.py) and the CLI scripts (backup_db.py, restore_db.py).
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import zipfile
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse, urlunparse

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from app.config import settings
from app.core.enums import EMITTER_STATUS_LABELS
from app.services.backup_prs_export import build_repository_prs_zip

FILENAME_RE = re.compile(r"^emitterdb_(\d{8})_(\d{6})\.dump$")
SCHEDULER_STATUS_FILE = "scheduler.json"


class BackupError(Exception):
    """A backup, verification or comparison couldn't be done — the message says why, for a person."""


# --- Connection details -------------------------------------------------------


def _parsed(database_url: str):
    return urlparse(database_url.replace("+psycopg2", ""))


def db_name(database_url: str) -> str:
    return _parsed(database_url).path.lstrip("/")


def _client_args(tool: str, database_url: str) -> tuple[list[str], dict]:
    """A pg_dump/pg_restore command line (host, port, user) and environment (password) for a URL."""
    parsed = _parsed(database_url)
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


#: Errors from settings that newer pg_restore versions send at the start of a
#: restore and an older server doesn't know (transaction_timeout is Postgres 17+).
#: They only tune the restore's own session, so they're safe to skip.
_HARMLESS_RESTORE_ERRORS = ('unrecognized configuration parameter "transaction_timeout"',)


def run_pg_restore(args: list[str], env: dict) -> tuple[bool, str | None, int]:
    """Runs pg_restore (without --exit-on-error, so a harmless setting an older
    server doesn't know can't stop it). Returns whether it worked, the first real
    error in plain words if not, and how many harmless errors were skipped."""
    result = subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env=env)
    lines = result.stderr.decode(errors="replace").splitlines()
    errors = [line for line in lines if "ERROR:" in line]
    real = [e for e in errors if not any(h in e for h in _HARMLESS_RESTORE_ERRORS)]
    skipped = len(errors) - len(real)
    if result.returncode == 0 or (errors and not real):
        return True, None, skipped
    if real:
        problem = real[0].split("ERROR:", 1)[1].strip()
    else:
        detail = [line for line in lines if line.strip() and not line.startswith("Command was")]
        problem = detail[-1] if detail else f"exit code {result.returncode}"
    return False, problem, skipped


def tool_major_version(tool: str) -> int | None:
    """The major version of pg_dump / pg_restore in this image ("pg_restore (PostgreSQL) 18.1" → 18)."""
    try:
        out = subprocess.run([tool, "--version"], capture_output=True, text=True, check=True).stdout
        return int(re.search(r"\(PostgreSQL\)\s+(\d+)", out).group(1))
    except (OSError, subprocess.CalledProcessError, AttributeError, ValueError):
        return None


def version_note(conn: Connection) -> str:
    """" (server Postgres 16, backup tools 18 — set PG_CLIENT_MAJOR=16 …)" when they differ, else ""."""
    try:
        server = int(conn.execute(text("SHOW server_version_num")).scalar_one()) // 10000
    except Exception:
        return ""
    tools = tool_major_version("pg_restore")
    if tools is None or tools == server:
        return ""
    return (
        f" (the database server is Postgres {server}, the backup tools are {tools}; "
        f"rebuild the image with PG_CLIENT_MAJOR={server} to match)"
    )


def verify_database_url() -> str:
    """The scratch database verification restores into: BACKUP_VERIFY_DATABASE_URL,
    or the live database's name with `_verify` on the same server (no query options —
    the dump recreates its own schema)."""
    if settings.backup_verify_database_url:
        return settings.backup_verify_database_url
    parsed = urlparse(settings.database_url)
    return urlunparse(parsed._replace(path=f"/{db_name(settings.database_url)}_verify", query=""))


def backup_dir() -> Path:
    return Path(settings.backup_dir)


# --- Files --------------------------------------------------------------------


def _when_from_name(name: str) -> datetime | None:
    m = FILENAME_RE.match(name)
    if not m:
        return None
    return datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)


def prs_path(dump: Path) -> Path:
    """The PRS export taken with a backup: emitterdb_…_prs.zip beside the dump."""
    return dump.with_name(f"{dump.stem}_prs.zip")


def _manifest_path(dump: Path) -> Path:
    return dump.with_suffix(".json")


def read_manifest(dump: Path) -> dict | None:
    path = _manifest_path(dump)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def write_manifest(dump: Path, manifest: dict) -> None:
    path = _manifest_path(dump)
    tmp = path.with_suffix(".json.part")
    tmp.write_text(json.dumps(manifest, indent=1, default=str))
    tmp.replace(path)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_dump(name: str, directory: Path | None = None) -> Path:
    """A backup by its file name — only names a backup could have, so a request can't
    reach outside the backup directory."""
    if not FILENAME_RE.match(name):
        raise BackupError(f"'{name}' isn't a backup name")
    path = (directory or backup_dir()) / name
    if not path.exists():
        raise BackupError(f"Backup {name} not found")
    return path


@dataclass
class BackupFile:
    path: Path
    when: datetime
    manifest: dict | None


def list_backups(directory: Path | None = None) -> list[BackupFile]:
    """Every backup in the directory, newest first, with its manifest where it has one."""
    directory = directory or backup_dir()
    if not directory.exists():
        return []
    out = []
    for path in directory.glob("emitterdb_*.dump"):
        when = _when_from_name(path.name)
        if when is not None:
            out.append(BackupFile(path=path, when=when, manifest=read_manifest(path)))
    return sorted(out, key=lambda b: b.when, reverse=True)


@contextmanager
def backup_lock(directory: Path):
    """One backup or verification at a time per directory — the scheduler and a
    "Back up now" click can't trip over each other."""
    directory.mkdir(parents=True, exist_ok=True)
    with open(directory / ".backup.lock", "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise BackupError("Another backup or verification is running — try again in a minute")
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


# --- What a backup holds --------------------------------------------------------


def compute_overview(conn: Connection) -> dict:
    """Each Emitter, Platform and MDF in one line: enough to say what changed between
    two backups without restoring either."""

    def rows(sql: str) -> list[dict]:
        return [dict(r) for r in conn.execute(text(sql)).mappings().all()]

    emitters = rows(
        """
        SELECT e.id::text AS id, e.name, e.designation, e.status, e.is_deleted AS deleted,
               (SELECT count(*) FROM modes m JOIN ew_groups g ON g.id = m.ew_group_id WHERE g.emitter_id = e.id)
                 AS modes,
               (SELECT max(v.version_number) FROM emitter_versions v WHERE v.emitter_id = e.id) AS version
        FROM emitters e ORDER BY e.name
        """
    )
    platform_pins: dict[str, list[dict]] = {}
    for r in rows(
        """
        SELECT l.platform_id::text AS owner, l.emitter_id::text AS id, e.name, v.version_number AS version
        FROM platform_emitter_links l
        JOIN emitters e ON e.id = l.emitter_id
        JOIN emitter_versions v ON v.id = l.emitter_version_id
        ORDER BY e.name
        """
    ):
        platform_pins.setdefault(r.pop("owner"), []).append(r)
    platforms = rows(
        """
        SELECT p.id::text AS id, p.name, p.is_deleted AS deleted,
               (SELECT max(v.version_number) FROM platform_versions v WHERE v.platform_id = p.id) AS version
        FROM platforms p ORDER BY p.name
        """
    )
    for p in platforms:
        p["pins"] = platform_pins.get(p["id"], [])
    mdf_pins: dict[str, list[dict]] = {}
    for r in rows(
        """
        SELECT l.mdf_id::text AS owner, l.platform_id::text AS id, p.name, v.version_number AS version
        FROM mdf_platform_links l
        JOIN platforms p ON p.id = l.platform_id
        JOIN platform_versions v ON v.id = l.platform_version_id
        ORDER BY p.name
        """
    ):
        mdf_pins.setdefault(r.pop("owner"), []).append(r)
    mdfs = rows(
        """
        SELECT m.id::text AS id, m.name, m.status, m.is_deleted AS deleted,
               (SELECT max(v.version_number) FROM mdf_versions v WHERE v.mdf_id = m.id) AS version
        FROM mdfs m ORDER BY m.name
        """
    )
    for m in mdfs:
        m["pins"] = mdf_pins.get(m["id"], [])
    return {"emitters": emitters, "platforms": platforms, "mdfs": mdfs}


def table_counts(conn: Connection) -> dict[str, int]:
    """Exact row counts of every table in the current schema."""
    tables = conn.execute(
        text("SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename")
    ).scalars().all()
    return {t: conn.execute(text(f'SELECT count(*) FROM "{t}"')).scalar_one() for t in tables}


def live_overview() -> dict:
    from app.database import engine

    with engine.connect() as conn:
        return compute_overview(conn)


def counts_summary(overview: dict | None) -> dict | None:
    if overview is None:
        return None
    return {
        key: sum(1 for item in overview[key] if not item.get("deleted"))
        for key in ("emitters", "platforms", "mdfs")
    }


# --- Taking a backup ------------------------------------------------------------


def take_backup(*, kind: str = "manual", created_by: str | None = None, directory: Path | None = None) -> dict:
    """Dumps the database and writes its manifest; returns the manifest. `kind` is
    "scheduled", "manual" or "before-restore"."""
    from app.database import engine

    directory = directory or backup_dir()
    with backup_lock(directory):
        when = datetime.now(timezone.utc)
        dump = directory / f"emitterdb_{when.strftime('%Y%m%d_%H%M%S')}.dump"
        if dump.exists():
            raise BackupError("A backup was taken this very second — try again")
        part = dump.with_suffix(".dump.part")

        # One exported snapshot for both the dump and the overview, so they can't disagree.
        with engine.connect() as raw:
            conn = raw.execution_options(isolation_level="REPEATABLE READ")
            with conn.begin():
                snapshot = conn.execute(text("SELECT pg_export_snapshot()")).scalar_one()
                snapshot_at = conn.execute(text("SELECT now()")).scalar_one()
                schema = conn.execute(text("SELECT current_schema()")).scalar_one()
                args, env = _client_args("pg_dump", settings.database_url)
                args += ["-Fc", f"--snapshot={snapshot}"]
                if schema != "public":
                    args += ["-n", schema]
                args.append(db_name(settings.database_url))
                with open(part, "wb") as out:
                    result = subprocess.run(args, stdout=out, stderr=subprocess.PIPE, env=env)
                if result.returncode != 0:
                    part.unlink(missing_ok=True)
                    detail = result.stderr.decode(errors="replace").strip().splitlines()
                    raise BackupError(f"pg_dump failed: {detail[-1] if detail else f'exit code {result.returncode}'}")
                overview = compute_overview(conn)
                counts = table_counts(conn)
                # The PRS export from the same snapshot, so it matches the dump. If it
                # can't be made, the database backup still stands — the record says why.
                try:
                    with Session(bind=conn) as session:
                        prs_bytes, prs_summary = build_repository_prs_zip(session, when)
                    prs_error = None
                except Exception as err:  # noqa: BLE001 — any failure here mustn't lose the dump
                    prs_bytes, prs_summary, prs_error = None, None, str(err) or err.__class__.__name__
                try:
                    alembic = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
                except Exception:  # no alembic table (a schema built straight from the models)
                    alembic = None
        part.replace(dump)
        prs_record: dict
        if prs_bytes is not None:
            prs = prs_path(dump)
            prs_part = prs.with_suffix(".zip.part")
            prs_part.write_bytes(prs_bytes)
            prs_part.replace(prs)
            prs_record = {"file": prs.name, "size_bytes": prs.stat().st_size, "sha256": _sha256(prs), **prs_summary}
        else:
            prs_record = {"error": prs_error}

        manifest = {
            "file": dump.name,
            "created_at": when.isoformat(),
            # The moment the data in it is from — changes after this aren't in it.
            "snapshot_at": snapshot_at.isoformat(),
            "kind": kind,
            "created_by": created_by,
            "size_bytes": dump.stat().st_size,
            "sha256": _sha256(dump),
            "database": db_name(settings.database_url),
            "schema": schema,
            "alembic_version": alembic,
            "counts": counts,
            "overview": overview,
            "overview_source": "backup",
            "prs_export": prs_record,
            "verification": None,
            "copied_to": None,
        }
        write_manifest(dump, manifest)
        if settings.backup_copy_dir:
            manifest["copied_to"] = _copy_out(dump, Path(settings.backup_copy_dir))
            write_manifest(dump, manifest)
        return manifest


def _copy_out(dump: Path, target: Path) -> str | None:
    """A second copy, somewhere other than the backup directory (another disk, a
    share). Returns where it went, or None if it couldn't be written — the backup
    itself still stands."""
    try:
        target.mkdir(parents=True, exist_ok=True)
        shutil.copy2(dump, target / dump.name)
        if prs_path(dump).exists():
            shutil.copy2(prs_path(dump), target / prs_path(dump).name)
        shutil.copy2(_manifest_path(dump), target / _manifest_path(dump).name)
        return str(target / dump.name)
    except OSError:
        return None


def prune_backups(
    directory: Path | None = None,
    keep_daily: int | None = None,
    keep_weekly: int | None = None,
    keep_monthly: int | None = None,
) -> list[Path]:
    """Keep the newest `keep_daily` backups outright, then thin older ones to roughly
    one a week for `keep_weekly` weeks and one a month for `keep_monthly` months;
    delete the rest (dump and manifest). Returns the dumps removed."""
    directory = directory or backup_dir()
    keep_daily = settings.backup_retention_daily if keep_daily is None else keep_daily
    keep_weekly = settings.backup_retention_weekly if keep_weekly is None else keep_weekly
    keep_monthly = settings.backup_retention_monthly if keep_monthly is None else keep_monthly
    backups = list_backups(directory)
    keep = {b.path for b in backups[:keep_daily]}
    rest = []
    weeks: set[tuple[int, int]] = set()
    for b in backups[keep_daily:]:
        year, week, _ = b.when.isocalendar()
        if (year, week) not in weeks and len(weeks) < keep_weekly:
            weeks.add((year, week))
            keep.add(b.path)
        else:
            rest.append(b)
    months: set[tuple[int, int]] = set()
    for b in rest:
        if (b.when.year, b.when.month) not in months and len(months) < keep_monthly:
            months.add((b.when.year, b.when.month))
            keep.add(b.path)
    removed = []
    for b in backups:
        if b.path not in keep:
            b.path.unlink(missing_ok=True)
            prs_path(b.path).unlink(missing_ok=True)
            _manifest_path(b.path).unlink(missing_ok=True)
            removed.append(b.path)
    return removed


# --- Verifying a backup ------------------------------------------------------------


def check_prs_export(dump: Path, manifest: dict) -> tuple[str | None, str]:
    """Whether the PRS export beside a backup is still there and whole: (problem
    or None, a note for the verification message)."""
    record = manifest.get("prs_export")
    if not record:
        return None, ""  # made before backups carried one
    if record.get("error"):
        return None, " · no PRS export (it couldn't be made: " + record["error"] + ")"
    prs = prs_path(dump)
    if not prs.exists():
        return f"The PRS export {prs.name} is missing", ""
    if record.get("sha256") and _sha256(prs) != record["sha256"]:
        return "The PRS export has changed since it was written — its checksum doesn't match", ""
    try:
        with zipfile.ZipFile(prs) as zf:
            bad = zf.testzip()
            count = len(zf.namelist())
    except zipfile.BadZipFile:
        return "The PRS export isn't a readable zip file", ""
    if bad:
        return f"The PRS export is damaged ({bad})", ""
    return None, f" · PRS export checked ({count} files)"


def verify_backup(name: str, directory: Path | None = None) -> dict:
    """Restores a backup into the scratch database, checks every table's row count
    against its manifest (or records them, for a backup made before manifests),
    and empties the scratch database again. Returns the updated manifest; the result
    is in its "verification" entry, failed or not."""
    directory = directory or backup_dir()
    dump = resolve_dump(name, directory)
    url = verify_database_url()
    scratch = db_name(url)
    if scratch == db_name(settings.database_url) and urlparse(url).hostname == urlparse(settings.database_url).hostname:
        raise BackupError("The verification database must not be the live database")

    with backup_lock(directory):
        manifest = read_manifest(dump) or {
            "file": dump.name,
            "created_at": _when_from_name(dump.name).isoformat(),
            "kind": "unknown",
            "created_by": None,
            "size_bytes": dump.stat().st_size,
            "sha256": None,
            "schema": "public",
            "counts": None,
            "overview": None,
            "overview_source": None,
            "copied_to": None,
        }
        schema = manifest.get("schema") or "public"
        started = datetime.now(timezone.utc)

        def record(ok: bool, message: str, **extra) -> dict:
            manifest["verification"] = {"at": started.isoformat(), "ok": ok, "message": message, **extra}
            write_manifest(dump, manifest)
            return manifest

        if manifest.get("sha256") and _sha256(dump) != manifest["sha256"]:
            return record(False, "The file has changed since it was written — its checksum doesn't match")
        prs_problem, prs_note = check_prs_export(dump, manifest)
        if prs_problem:
            return record(False, prs_problem)

        scratch_engine = create_engine(url, poolclass=NullPool)
        try:
            with scratch_engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        except OperationalError:
            user = urlparse(settings.database_url).username or "the app's role"
            raise BackupError(
                f"Verification needs a scratch database to restore into. Create it once on the Postgres server: "
                f"CREATE DATABASE {scratch} OWNER {user};"
            )

        try:
            args, env = _client_args("pg_restore", url)
            args += ["--clean", "--if-exists", "--no-owner", "-d", scratch, str(dump)]
            ok, problem, _skipped = run_pg_restore(args, env)
            if not ok:
                with scratch_engine.connect() as conn:
                    note = version_note(conn)
                return record(False, f"Restore failed: {problem}{note}")
            with scratch_engine.connect() as conn:
                conn.execute(text(f'SET search_path TO "{schema}"'))
                counts = table_counts(conn)
                if manifest.get("overview") is None:
                    manifest["overview"] = compute_overview(conn)
                    manifest["overview_source"] = "verification"
            expected = manifest.get("counts")
            if expected is None:
                manifest["counts"] = counts
                return record(True, f"Restored {len(counts)} tables — no earlier counts to compare with{prs_note}", tables=len(counts), rows=sum(counts.values()))
            wrong = [
                f"{t}: {counts.get(t, 'missing')} rows, expected {n}" for t, n in expected.items() if counts.get(t) != n
            ]
            if wrong:
                return record(False, "Row counts differ — " + "; ".join(wrong[:5]), tables=len(counts))
            return record(True, f"Restored and checked {len(counts)} tables, {sum(counts.values()):,} rows{prs_note}", tables=len(counts), rows=sum(counts.values()))
        finally:
            # Empty the scratch database again — it only ever holds a copy for as long as the check takes.
            try:
                with scratch_engine.begin() as conn:
                    conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
                    conn.execute(text(f'CREATE SCHEMA "{schema}"'))
            except Exception:
                pass
            scratch_engine.dispose()


# --- Comparing what backups hold -----------------------------------------------------


def _status(kind: str, value: str | None) -> str | None:
    if value is None:
        return None
    if kind == "emitters":
        return EMITTER_STATUS_LABELS.get(value, value)
    words = value.replace("_", " ")
    return words[:1].upper() + words[1:]


def _pin_changes(old: list[dict], new: list[dict]) -> list[str]:
    before = {p["id"]: p for p in old}
    after = {p["id"]: p for p in new}
    out = []
    for pid, p in after.items():
        if pid not in before:
            out.append(f"Pinned {p['name']} v{p['version']}")
        elif before[pid]["version"] != p["version"]:
            out.append(f"{p['name']} pin: v{before[pid]['version']} → v{p['version']}")
    for pid, p in before.items():
        if pid not in after:
            out.append(f"Unpinned {p['name']}")
    return out


def _item_changes(kind: str, old: dict, new: dict) -> list[str]:
    out = []
    if old["name"] != new["name"]:
        out.append(f"Renamed from {old['name']}")
    if kind == "emitters" and (old.get("designation") or None) != (new.get("designation") or None):
        out.append(f"Designation: {old.get('designation') or '—'} → {new.get('designation') or '—'}")
    if old.get("deleted") != new.get("deleted"):
        out.append("Moved to Recently Deleted" if new.get("deleted") else "Restored from Recently Deleted")
    if "status" in new and old.get("status") != new.get("status"):
        out.append(f"Status: {_status(kind, old.get('status'))} → {_status(kind, new.get('status'))}")
    if kind == "emitters" and old.get("modes") != new.get("modes"):
        out.append(f"Modes: {old.get('modes')} → {new.get('modes')}")
    if old.get("version") != new.get("version"):
        out.append(
            f"Saved version: v{old['version']} → v{new['version']}" if old.get("version") else f"First saved as v{new['version']}"
        )
    if kind != "emitters":
        out += _pin_changes(old.get("pins", []), new.get("pins", []))
    return out


def diff_overviews(old: dict, new: dict) -> dict:
    """What changed from one overview to another, per kind: added, removed and changed
    items (each change as a short line), and how many stayed the same (not counting
    ones that sat in Recently Deleted throughout)."""
    result = {}
    for kind in ("emitters", "platforms", "mdfs"):
        before = {item["id"]: item for item in old.get(kind, [])}
        after = {item["id"]: item for item in new.get(kind, [])}
        added = [after[i] for i in after if i not in before]
        removed = [before[i] for i in before if i not in after]
        changed, same = [], 0
        for i in after:
            if i in before:
                lines = _item_changes(kind, before[i], after[i])
                if lines:
                    changed.append({"id": i, "name": after[i]["name"], "changes": lines})
                elif not after[i].get("deleted"):
                    same += 1
        result[kind] = {
            "added": [{"id": a["id"], "name": a["name"], "deleted": bool(a.get("deleted"))} for a in added],
            "removed": [{"id": r["id"], "name": r["name"]} for r in removed],
            "changed": changed,
            "unchanged": same,
        }
    return result


# --- Health ---------------------------------------------------------------------------


def scheduler_status(directory: Path | None = None) -> dict | None:
    path = (directory or backup_dir()) / SCHEDULER_STATUS_FILE
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def write_scheduler_status(status: dict, directory: Path | None = None) -> None:
    directory = directory or backup_dir()
    directory.mkdir(parents=True, exist_ok=True)
    tmp = directory / f"{SCHEDULER_STATUS_FILE}.part"
    tmp.write_text(json.dumps(status, indent=1, default=str))
    tmp.replace(directory / SCHEDULER_STATUS_FILE)


_WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def schedule_weekday() -> int | None:
    """The weekday automatic backups run on (Monday = 0), or None for every day."""
    day = settings.backup_schedule_day.strip().lower()
    if day in ("daily", "every day", "*"):
        return None
    for i, name in enumerate(_WEEKDAYS):
        if len(day) >= 3 and name.startswith(day):
            return i
    raise ValueError(f"BACKUP_SCHEDULE_DAY must be a weekday or 'daily', not {settings.backup_schedule_day!r}")


def schedule_label() -> str:
    """"Sundays at 03:00 UTC" / "Every day at 03:00 UTC"."""
    weekday = schedule_weekday()
    when = f"at {settings.backup_schedule_time} UTC"
    return f"Every day {when}" if weekday is None else f"{_WEEKDAYS[weekday].capitalize()}s {when}"


def next_scheduled_backup(now: datetime) -> datetime:
    hour, minute = (int(x) for x in settings.backup_schedule_time.split(":"))
    run = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if run <= now:
        run += timedelta(days=1)
    weekday = schedule_weekday()
    if weekday is not None:
        run += timedelta(days=(weekday - run.weekday()) % 7)
    return run


def schedule_interval() -> timedelta:
    return timedelta(days=1 if schedule_weekday() is None else 7)


# --- Freshness: how much a lost database would cost ---------------------------------

#: Audit Log actions that aren't changes to the data.
_NOT_CHANGES = ["login", "login_failed", "logout", "checkout", "checkin", "download"]
MIN_DUE_HOURS = 12
MAX_DUE_HOURS = 4 * 7 * 24


def changes_since(conn: Connection, since: datetime) -> int:
    """Changes made since a moment — every Audit Log entry that edits data (not
    sign-ins, starting or ending an edit, downloads, or backups themselves)."""
    return conn.execute(
        text(
            "SELECT count(*) FROM audit_log WHERE created_at > :since"
            " AND entity_type <> 'backup' AND NOT (action::text = ANY(:skip))"
        ),
        {"since": since, "skip": _NOT_CHANGES},
    ).scalar_one()


def due_after_hours(changes: int) -> float | None:
    """How long after a backup the next is due, given the changes made since: a week
    at BACKUP_CHANGES_PER_WEEK, shorter the more there are. None when nothing changed."""
    if changes <= 0:
        return None
    hours = 7 * 24 * settings.backup_changes_per_week / changes
    return min(MAX_DUE_HOURS, max(MIN_DUE_HOURS, hours))


def _age_text(hours: float) -> str:
    if hours < 1:
        return "under an hour"
    if hours < 48:
        n = int(hours)
        return f"{n} hour{'s' if n != 1 else ''}"
    n = int(hours // 24)
    return f"{n} days"


#: Changed items named per kind on the dashboard, beyond which only counted.
NAMED_PER_KIND = 5


def backup_freshness(directory: Path | None = None, now: datetime | None = None) -> dict:
    """How long since the latest backup, what's changed since, and whether a backup is
    due: "ok", "due" (past its due time), "overdue" (twice past), or "none" (never
    backed up). The due time shrinks as changes pile up — see due_after_hours."""
    from app.database import engine

    directory = directory or backup_dir()
    now = now or datetime.now(timezone.utc)
    backups = list_backups(directory)
    latest = backups[0] if backups else None
    scheduler = scheduler_status(directory) or {}
    out = {
        "level": "none",
        "latest_backup_at": None,
        "age_hours": None,
        "changes": None,
        "due_after_hours": None,
        "due_at": None,
        "changes_per_week": settings.backup_changes_per_week,
        "kinds": None,
        "schedule": schedule_label(),
        "next_scheduled_at": scheduler.get("next_run_at"),
    }
    if latest is None:
        return out
    # The moment the backup's data is from; the file name's time is only to the second.
    m = latest.manifest or {}
    taken = datetime.fromisoformat(m.get("snapshot_at") or m.get("created_at") or latest.when.isoformat())
    with engine.connect() as conn:
        changes = changes_since(conn, taken)
        base = next((b for b in backups if b.manifest and b.manifest.get("overview") is not None), None)
        live = compute_overview(conn) if base else None
    age = (now - latest.when).total_seconds() / 3600
    due = due_after_hours(changes)
    out.update(
        latest_backup_at=latest.when.isoformat(),
        age_hours=round(age, 2),
        changes=changes,
        due_after_hours=due,
        due_at=(latest.when + timedelta(hours=due)).isoformat() if due else None,
        level="ok" if due is None or age < due else "due" if age < 2 * due else "overdue",
    )
    if base is not None:
        diff = diff_overviews(base.manifest["overview"], live)
        out["kinds"] = {
            kind: {
                "added": len(d["added"]),
                "removed": len(d["removed"]),
                "changed": len(d["changed"]),
                "named": (
                    [{"id": a["id"], "name": a["name"], "how": "added"} for a in d["added"]]
                    + [{"id": c["id"], "name": c["name"], "how": "changed"} for c in d["changed"]]
                    + [{"id": r["id"], "name": r["name"], "how": "removed"} for r in d["removed"]]
                )[:NAMED_PER_KIND],
            }
            for kind, d in diff.items()
        }
    return out


def backup_health(directory: Path | None = None, now: datetime | None = None) -> dict:
    """Whether backups are in order, and if not, what an admin should know."""
    directory = directory or backup_dir()
    backups = list_backups(directory)
    now = now or datetime.now(timezone.utc)
    problems: list[str] = []
    latest = backups[0] if backups else None
    freshness = backup_freshness(directory, now)
    if latest is None:
        problems.append("No backups have been taken yet")
    elif freshness["level"] in ("due", "overdue"):
        problems.append(
            f"A backup is {'overdue' if freshness['level'] == 'overdue' else 'due'}: the latest is"
            f" {_age_text(freshness['age_hours'])} old and {freshness['changes']} changes have been made since"
        )
    verified = [b for b in backups if b.manifest and b.manifest.get("verification")]
    last_check = verified[0].manifest["verification"] if verified else None
    if last_check and not last_check.get("ok"):
        problems.append(f"The last verification failed: {last_check.get('message')}")
    elif backups and not last_check:
        problems.append("No backup has been verified yet")
    scheduler = scheduler_status(directory)
    if scheduler is None:
        problems.append("The backup scheduler hasn't reported in — is its container running?")
    else:
        beat = scheduler.get("heartbeat_at")
        if beat and now - datetime.fromisoformat(beat) > timedelta(minutes=15):
            problems.append(f"The backup scheduler hasn't checked in since {beat[:16].replace('T', ' ')} UTC — is its container running?")
        if scheduler.get("last_error"):
            problems.append(f"The scheduler's last run had a problem: {scheduler['last_error']}")
        if scheduler.get("last_purge_error"):
            problems.append(f"Emptying old Recently Deleted items failed: {scheduler['last_purge_error']}")
    return {
        "ok": not problems,
        "problems": problems,
        "latest_backup_at": latest.when.isoformat() if latest else None,
        "last_verification": last_check,
        "scheduler": scheduler,
        "copy_dir": settings.backup_copy_dir,
        "schedule": schedule_label(),
        "freshness": freshness,
    }
