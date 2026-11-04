"""Whole recordings: upload an EmitterTrackParameters CSV (often 100 MB), look
it over (RF, PRI and PW over time, filtered), and snip out the reports to
group into an Intercept (see app/models/recording.py)."""

from __future__ import annotations

import hashlib
import logging
import tempfile
import threading
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import case, func, or_, select, tuple_
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.config import settings
from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, PriType, Role
from app.database import get_db
from app.deps import require_role
from app.models.intercept import Intercept
from app.models.recording import Recording, RecordingReport
from app.services import recording_csv
from app.services.audit_service import record_audit

log = logging.getLogger(__name__)
router = APIRouter(prefix="/recordings", tags=["recordings"])

#: Parts of an upload: under the proxy's 20 MB limit on one request.
CHUNK_BYTES = 8 * 1024 * 1024
MAX_BYTES = 4 * 1024 * 1024 * 1024
#: A snip goes into the grouping tools, which take at most this many reports.
MAX_SNIP = 100_000
#: The overview: time bins across, value bins up — the dots drawn as density.
TIME_BINS = 480
VALUE_BINS = 140
PARAMS = {"rf": RecordingReport.rf_mhz, "pri": RecordingReport.pri_us, "pw": RecordingReport.pw_us}


def _upload_dir() -> Path:
    path = Path(settings.upload_dir or Path(tempfile.gettempdir()) / "prs-uploads")
    path.mkdir(parents=True, exist_ok=True)
    return path


def _upload_path(recording_id: uuid.UUID) -> Path:
    return _upload_dir() / f"{recording_id}.csv"


# --- Shapes ----------------------------------------------------------------------


class RecordingCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    size_bytes: int = Field(gt=0, le=MAX_BYTES)
    description: str | None = Field(default=None, max_length=5000)


class RecordingUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=5000)


class InterceptBrief(BaseModel):
    id: uuid.UUID
    name: str
    emitter_id: uuid.UUID
    entry_count: int
    snip: dict | None = None


class RecordingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    size_bytes: int
    status: str
    error: str | None = None
    report_count: int
    skipped_count: int
    skipped_sample: list[str] | None = None
    first_time: datetime | None = None
    last_time: datetime | None = None
    description: str | None = None
    created_at: datetime
    uploaded_by_username: str | None = None
    chunk_bytes: int = CHUNK_BYTES
    intercepts: list[InterceptBrief] = []
    # False on the offline app: its copy has the recording but not its reports.
    reports_here: bool = True
    # Set when the file had been uploaded before: this is that recording.
    already_uploaded: bool = False


def _out(db: Session, rec: Recording, **extra) -> RecordingOut:
    out = RecordingOut.model_validate(rec)
    out.uploaded_by_username = rec.uploader.username if rec.uploader else None
    rows = db.execute(
        select(Intercept.id, Intercept.name, Intercept.emitter_id, Intercept.snip)
        .where(Intercept.recording_id == rec.id)
        .order_by(Intercept.created_at)
    ).all()
    if rows:
        from app.models.intercept import InterceptEntry

        counts = dict(
            db.execute(
                select(InterceptEntry.intercept_id, func.count())
                .where(InterceptEntry.intercept_id.in_([r[0] for r in rows]))
                .group_by(InterceptEntry.intercept_id)
            ).all()
        )
        out.intercepts = [InterceptBrief(id=r[0], name=r[1], emitter_id=r[2], entry_count=counts.get(r[0], 0), snip=r[3]) for r in rows]
    if rec.status == "ready" and rec.report_count:
        out.reports_here = db.scalar(
            select(func.count()).select_from(
                select(RecordingReport.id).where(RecordingReport.recording_id == rec.id).limit(1).subquery()
            )
        ) > 0
    for k, v in extra.items():
        setattr(out, k, v)
    return out


#: Recordings this server is reading right now (it runs as one process).
_READING: set[uuid.UUID] = set()


def _recover(db: Session, rec: Recording) -> None:
    """A recording left "processing" by a server that stopped while reading it:
    what was read goes, and it says to upload the file again."""
    if rec.status != "processing" or rec.id in _READING:
        return
    db.execute(RecordingReport.__table__.delete().where(RecordingReport.recording_id == rec.id))
    rec.status = "failed"
    rec.report_count = 0
    rec.error = "The server stopped while reading this file — delete it and upload the file again."
    db.commit()
    _upload_path(rec.id).unlink(missing_ok=True)


def _get(db: Session, recording_id: uuid.UUID) -> Recording:
    rec = db.get(Recording, recording_id)
    if rec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recording not found")
    _recover(db, rec)
    return rec


# --- Upload ------------------------------------------------------------------------


@router.post("", response_model=RecordingOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
def start_upload(payload: RecordingCreate, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))) -> RecordingOut:
    """Starts an upload: send the file in parts of `chunk_bytes`, then complete it."""
    rec = Recording(
        name=payload.name.strip(), size_bytes=payload.size_bytes, description=payload.description, uploaded_by=user.id, status="uploading"
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    _upload_path(rec.id).unlink(missing_ok=True)
    return _out(db, rec)


@router.put("/{recording_id}/chunks/{index}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
async def upload_chunk(
    recording_id: uuid.UUID,
    index: int,
    request: Request,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.editor)),
) -> Response:
    """One part of the file, at its place (parts can be sent again)."""
    rec = _get(db, recording_id)
    if rec.status != "uploading":
        raise HTTPException(status.HTTP_409_CONFLICT, "This recording isn't being uploaded")
    body = await request.body()
    if len(body) > CHUNK_BYTES or index < 0 or index * CHUNK_BYTES + len(body) > rec.size_bytes:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That part doesn't fit the file")
    path = _upload_path(rec.id)
    with open(path, "r+b" if path.exists() else "wb") as f:
        f.seek(index * CHUNK_BYTES)
        f.write(body)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{recording_id}/complete", response_model=RecordingOut, dependencies=[Depends(verify_csrf)])
def complete_upload(
    recording_id: uuid.UUID,
    wait: bool = False,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> RecordingOut:
    """All parts are in: the file is read into reports — in the background (poll
    the recording for its status), or before answering with `wait`."""
    rec = _get(db, recording_id)
    if rec.status != "uploading":
        raise HTTPException(status.HTTP_409_CONFLICT, "This recording isn't being uploaded")
    path = _upload_path(rec.id)
    have = path.stat().st_size if path.exists() else 0
    if have != rec.size_bytes:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Only {have:,} of {rec.size_bytes:,} bytes have arrived — send the rest")
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(block)
    sha = digest.hexdigest()
    earlier = db.scalar(select(Recording).where(Recording.sha256 == sha, Recording.status == "ready", Recording.id != rec.id))
    if earlier is not None:
        path.unlink(missing_ok=True)
        db.delete(rec)
        db.commit()
        return _out(db, earlier, already_uploaded=True)
    rec.sha256 = sha
    rec.status = "processing"
    _READING.add(rec.id)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.recording.value,
        entity_id=rec.id,
        summary=f"Uploaded recording '{rec.name}' ({rec.size_bytes / 1_048_576:.1f} MB)",
        changes={"size_bytes": rec.size_bytes, "sha256": sha},
    )
    db.commit()
    engine = db.get_bind()
    if wait:
        _process(engine, rec.id, path)
        db.expire_all()
    else:
        threading.Thread(target=_process, args=(engine, rec.id, path), daemon=True, name=f"recording-{rec.id}").start()
    return _out(db, _get(db, rec.id))


def _copy_value(v) -> str:
    if v is None:
        return "\\N"
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, list):
        return "{" + ",".join(repr(float(x)) for x in v) + "}"
    if isinstance(v, float):
        return repr(v)
    s = str(v)
    return s.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


_COPY_COLUMNS = (
    "recording_id", "file_line", "mission_time", "track", "mode_track", "power", "designation", "mode_name",
    "ambiguity_count", "pri_type", "rf_mhz", "pri_us", "pw_us", "jitter_us", "stagger_us",
)


def _process(engine: Engine, recording_id: uuid.UUID, path: Path) -> None:
    """Reads the uploaded file into its reports, 20,000 at a time (COPY), then
    marks the recording ready — or failed, with the reason, and nothing kept."""
    import io

    skipped = recording_csv.Skipped()
    count = 0
    _READING.add(recording_id)
    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        buf = io.StringIO()
        rid = str(recording_id)

        def flush():
            buf.seek(0)
            cur.copy_expert(f"COPY recording_reports ({', '.join(_COPY_COLUMNS)}) FROM STDIN", buf)
            buf.seek(0)
            buf.truncate()

        with open(path, "rb") as f:
            for r in recording_csv.read_reports(recording_csv.text_lines(f), skipped):
                buf.write(
                    "\t".join(
                        _copy_value(v)
                        for v in (
                            rid, r.file_line, r.mission_time, r.track, r.mode_track, r.power, r.designation, r.mode_name,
                            r.ambiguity_count, r.pri_type, r.rf_mhz, r.pri_us, r.pw_us, r.jitter_us, r.stagger_us,
                        )
                    )
                    + "\n"
                )
                count += 1
                if count % 20_000 == 0:
                    flush()
                    # Committed as it goes, so the page can show how far it's got; a
                    # failure (or a restart, see _get) deletes what was read.
                    cur.execute("UPDATE recordings SET report_count = %s WHERE id = %s", (count, rid))
                    raw.commit()
        flush()
        cur.execute(
            "SELECT min(mission_time), max(mission_time) FROM recording_reports WHERE recording_id = %s", (rid,)
        )
        first, last = cur.fetchone()
        status_value, error = ("ready", None) if count else ("failed", "No reports could be read from this file.")
        cur.execute(
            "UPDATE recordings SET status = %s, error = %s, report_count = %s, skipped_count = %s, "
            "skipped_sample = %s, first_time = %s, last_time = %s WHERE id = %s",
            (status_value, error, count, skipped.count, skipped.sample or None, first, last, rid),
        )
        raw.commit()
    except Exception as err:  # the reason, for a person; nothing half-read is kept
        raw.rollback()
        message = str(err) if isinstance(err, recording_csv.CsvFormatError) else f"Couldn't read the file: {err}"
        log.exception("Reading recording %s failed", recording_id)
        cur = raw.cursor()
        cur.execute("DELETE FROM recording_reports WHERE recording_id = %s", (str(recording_id),))
        cur.execute(
            "UPDATE recordings SET status = 'failed', error = %s, report_count = 0 WHERE id = %s",
            (message[:2000], str(recording_id)),
        )
        raw.commit()
    finally:
        raw.close()
        path.unlink(missing_ok=True)
        _READING.discard(recording_id)


# --- Reading -----------------------------------------------------------------------


@router.get("", response_model=list[RecordingOut])
def list_recordings(db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> list[RecordingOut]:
    recs = db.scalars(select(Recording).order_by(Recording.created_at.desc())).all()
    for rec in recs:
        _recover(db, rec)
    return [_out(db, r) for r in recs]


@router.get("/{recording_id}", response_model=RecordingOut)
def get_recording(recording_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> RecordingOut:
    return _out(db, _get(db, recording_id))


@router.patch("/{recording_id}", response_model=RecordingOut, dependencies=[Depends(verify_csrf)])
def update_recording(
    recording_id: uuid.UUID, payload: RecordingUpdate, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> RecordingOut:
    rec = _get(db, recording_id)
    changes = {}
    for field_name in payload.model_fields_set:
        new = getattr(payload, field_name)
        if field_name == "name":
            new = (new or "").strip() or rec.name
        if new != getattr(rec, field_name):
            changes[field_name] = {"old": getattr(rec, field_name), "new": new}
            setattr(rec, field_name, new)
    if changes:
        record_audit(
            db, actor_id=user.id, action=AuditAction.update, entity_type=AuditEntityType.recording.value,
            entity_id=rec.id, summary=f"Updated recording '{rec.name}'", changes=changes,
        )
        db.commit()
    return _out(db, rec)


@router.delete("/{recording_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_recording(recording_id: uuid.UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))) -> None:
    """The recording and its reports go; Intercepts snipped from it stay (they
    keep their own reports), just no longer linked to it."""
    rec = _get(db, recording_id)
    if rec.status == "processing":
        raise HTTPException(status.HTTP_409_CONFLICT, "It's still being read — delete it once that's done")
    if rec.status != "uploading":  # an upload never finished was never logged as one
        record_audit(
            db, actor_id=user.id, action=AuditAction.delete, entity_type=AuditEntityType.recording.value,
            entity_id=rec.id, summary=f"Deleted recording '{rec.name}' ({rec.report_count:,} reports)",
            changes={"name": rec.name, "report_count": rec.report_count},
        )
    db.execute(RecordingReport.__table__.delete().where(RecordingReport.recording_id == rec.id))
    db.delete(rec)
    db.commit()
    _upload_path(recording_id).unlink(missing_ok=True)


class Filters(BaseModel):
    t0: datetime | None = None
    t1: datetime | None = None
    rf_min: float | None = None
    rf_max: float | None = None
    pri_min: float | None = None
    pri_max: float | None = None
    pw_min: float | None = None
    pw_max: float | None = None
    # "fixed,stagger,cw"
    types: str | None = None
    # "11,12" — any of these track numbers.
    tracks: str | None = None
    # Text in what the system identified it as (designation or mode name).
    identified: str | None = None


def _where(recording_id: uuid.UUID, f: Filters) -> list:
    r = RecordingReport
    w = [r.recording_id == recording_id]
    if f.t0 is not None:
        w.append(r.mission_time >= f.t0)
    if f.t1 is not None:
        w.append(r.mission_time <= f.t1)
    for key, col in PARAMS.items():
        lo, hi = getattr(f, f"{key}_min"), getattr(f, f"{key}_max")
        if lo is not None:
            w.append(col >= lo)
        if hi is not None:
            w.append(col <= hi)
    if f.types:
        wanted = [t.strip() for t in f.types.split(",") if t.strip() in PriType.__members__]
        w.append(r.pri_type.in_([PriType[t] for t in wanted]))
    if f.tracks:
        w.append(r.track.in_([t.strip() for t in f.tracks.split(",") if t.strip()]))
    if f.identified:
        like = f"%{f.identified.strip()}%"
        w.append(or_(r.designation.ilike(like), r.mode_name.ilike(like)))
    return w


def _ready(db: Session, recording_id: uuid.UUID) -> Recording:
    rec = _get(db, recording_id)
    if rec.status != "ready":
        raise HTTPException(status.HTTP_409_CONFLICT, f"The recording isn't ready ({rec.status})")
    return rec


def _bin(value, lo: float, span: float, bins: int):
    """Which of `bins` equal steps from `lo` a value falls in — null when it has
    none (LEAST alone would put a null in the last bin)."""
    return case((value.is_(None), None), else_=func.least(func.floor((value - lo) / span * bins), bins - 1))


@router.get("/{recording_id}/overview")
def overview(
    recording_id: uuid.UUID,
    f: Filters = Depends(),
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> dict:
    """What the filtered reports look like over time — RF, PRI and PW as
    density (time × value bins with a count each), a count per time bin, the
    count by PRI type and the most common identifications — drawn by the page
    instead of a million dots."""
    _ready(db, recording_id)
    r = RecordingReport
    where = _where(recording_id, f)
    epoch = func.extract("epoch", r.mission_time)
    # Pass 1: how many, and the extent of time and of each parameter.
    stats = db.execute(
        select(
            func.count(),
            func.count().filter(r.mission_time.is_(None)),
            func.min(epoch),
            func.max(epoch),
            *[agg(col) for col in PARAMS.values() for agg in (func.min, func.max)],
        ).where(*where)
    ).one()
    total, no_time, t_lo, t_hi = stats[0], stats[1], stats[2], stats[3]
    extent = {key: (stats[4 + 2 * i], stats[5 + 2 * i]) for i, key in enumerate(PARAMS)}
    if f.t0 is not None:
        t_lo = f.t0.timestamp()
    if f.t1 is not None:
        t_hi = f.t1.timestamp()
    out: dict = {
        "total": total,
        "without_time": no_time,
        "time": {"min": float(t_lo) if t_lo is not None else None, "max": float(t_hi) if t_hi is not None else None, "bins": TIME_BINS},
        "counts": [],
        "params": {key: None for key in PARAMS},
        "by_type": {},
        "identified": [],
        "max_snip": MAX_SNIP,
    }
    if not total:
        return out

    # Pass 2: every count the page draws, in one go (grouping sets).
    timed = t_lo is not None and t_hi is not None
    t_span = max(float(t_hi) - float(t_lo), 1e-6) if timed else 1.0
    tb = _bin(epoch, float(t_lo or 0), t_span, TIME_BINS).label("tb")
    value_bins = {}
    for key, col in PARAMS.items():
        lo, hi = extent[key]
        if getattr(f, f"{key}_min") is not None:
            lo = getattr(f, f"{key}_min")
        if getattr(f, f"{key}_max") is not None:
            hi = getattr(f, f"{key}_max")
        if lo is None or hi is None:
            continue
        span = max(float(hi) - float(lo), 1e-9)
        value_bins[key] = (
            float(lo),
            float(hi),
            _bin(col, float(lo), span, VALUE_BINS).label(f"{key}_b"),
        )
    ident = func.coalesce(r.designation, r.mode_name).label("ident")
    labelled = [r.pri_type.label("ptype"), ident, tb, *[vb for _lo, _hi, vb in value_bins.values()]]
    binned = select(*labelled).where(*where).subquery()
    c = binned.c
    sets = [tuple_(c.ptype), tuple_(c.ident)]
    if timed:
        sets.append(tuple_(c.tb))
        sets += [tuple_(c.tb, c[f"{key}_b"]) for key in value_bins]
    cols = [c[col.name] for col in labelled]
    rows = db.execute(
        select(*cols, func.count(), func.grouping(*cols).label("g")).group_by(func.grouping_sets(*sets))
    ).all()
    # GROUPING() sets a bit for each column *not* in the row's set (first column = highest bit).
    n = len(labelled)
    bit = {c.name: 1 << (n - 1 - i) for i, c in enumerate(labelled)}
    full = (1 << n) - 1
    cells: dict[str, list] = {key: [] for key in value_bins}
    identified = []
    for row in rows:
        g, count = row.g, row[n]
        present = full & ~g
        if present == bit["ptype"]:
            out["by_type"][getattr(row.ptype, "name", row.ptype)] = count
        elif present == bit["ident"]:
            identified.append({"label": row.ident, "count": count})
        elif present == bit["tb"]:
            if row.tb is not None:
                out["counts"].append([int(row.tb), count])
        else:
            for key in value_bins:
                if present == bit["tb"] | bit[f"{key}_b"]:
                    vb = getattr(row, f"{key}_b")
                    if row.tb is not None and vb is not None:
                        cells[key].append([int(row.tb), int(vb), count])
    identified.sort(key=lambda i: -i["count"])
    out["identified"] = identified[:12]
    for key, (lo, hi, _vb) in value_bins.items():
        out["params"][key] = {"min": lo, "max": hi, "bins": VALUE_BINS, "cells": cells[key]}
    return out


#: A snip's reports, as rows — the order of the fields the page reads.
SNIP_FIELDS = (
    "file_line", "mission_time", "track", "mode_track", "power", "designation", "mode_name", "ambiguity_count",
    "pri_type", "rf_mhz", "pri_us", "pw_us", "jitter_us", "stagger_us",
)


@router.get("/{recording_id}/reports")
def snip_reports(
    recording_id: uuid.UUID,
    f: Filters = Depends(),
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> Response:
    """The reports a snip holds, compactly (one array per report, the fields
    named once) — at most 100,000, which the grouping tools take."""
    import json

    rec = _ready(db, recording_id)
    where = _where(recording_id, f)
    total = db.scalar(select(func.count()).where(*where)) or 0
    if total > MAX_SNIP:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"The snip holds {total:,} reports; at most {MAX_SNIP:,} can be grouped at once — narrow it down.",
        )
    r = RecordingReport
    cols = [getattr(r, name) for name in SNIP_FIELDS]
    rows = []
    for row in db.execute(select(*cols).where(*where).order_by(r.file_line)):
        values = list(row)
        values[1] = values[1].isoformat() if values[1] else None
        values[8] = values[8].name
        rows.append(values)
    body = {"recording": rec.name, "fields": list(SNIP_FIELDS), "reports": rows}
    return Response(content=json.dumps(body, separators=(",", ":")), media_type="application/json")

