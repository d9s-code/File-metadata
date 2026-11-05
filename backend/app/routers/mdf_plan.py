"""An MDF's plan and history: its goals (its own list, ticked when reached),
a log of how it's going and how it went out, release notes per saved
version, and a summary of what changed between two versions — on the page, or as a Word document."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.downloads import attachment_disposition
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_role
from app.models.audit_log import AuditLog
from app.models.customer import Customer
from app.models.mdf import Mdf, MdfVersion
from app.models.mdf_plan import MdfGoal, MdfLogEntry
from app.services import statuses
from app.services.audit_service import record_audit
from app.services.docx_writer import Block, write_docx
from app.services.pinned_changes import mdf_change_summary

router = APIRouter(prefix="/mdfs", tags=["mdf-plan"])

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
LOG_KINDS = ("progress", "release")


def _mdf(db: Session, mdf_id: uuid.UUID, *, writing: bool = False) -> Mdf:
    mdf = db.get(Mdf, mdf_id)
    if mdf is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MDF not found")
    if writing and mdf.is_deleted:
        raise HTTPException(status.HTTP_409_CONFLICT, "This MDF is in the Trash — restore it first")
    return mdf


def _audit(db: Session, mdf: Mdf, user_id, action: AuditAction, summary: str, changes: dict) -> None:
    """Filed under the MDF itself, so it shows on its Audit tab."""
    record_audit(
        db,
        actor_id=user_id,
        action=action,
        entity_type=AuditEntityType.mdf.value,
        entity_id=mdf.id,
        summary=f"MDF '{mdf.name}': {summary}",
        changes=changes,
    )


# --- Goals --------------------------------------------------------------------------


class GoalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    text: str
    position: int
    done_at: datetime | None
    done_note: str | None
    done_by_username: str | None = None
    created_at: datetime


class GoalCreate(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class GoalUpdate(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=2000)
    done: bool | None = None
    note: str | None = Field(default=None, max_length=2000)


class GoalOrder(BaseModel):
    ids: list[uuid.UUID] = Field(max_length=500)


def _goal_out(g: MdfGoal) -> GoalOut:
    out = GoalOut.model_validate(g)
    out.done_by_username = g.doer.username if g.doer else None
    return out


def _goals(db: Session, mdf_id: uuid.UUID) -> list[MdfGoal]:
    return db.scalars(select(MdfGoal).where(MdfGoal.mdf_id == mdf_id).order_by(MdfGoal.position, MdfGoal.created_at)).all()


@router.get("/{mdf_id}/goals", response_model=list[GoalOut])
def list_goals(mdf_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> list[GoalOut]:
    _mdf(db, mdf_id)
    return [_goal_out(g) for g in _goals(db, mdf_id)]


@router.post("/{mdf_id}/goals", response_model=GoalOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
def add_goal(
    mdf_id: uuid.UUID, payload: GoalCreate, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> GoalOut:
    mdf = _mdf(db, mdf_id, writing=True)
    last = db.scalar(select(func.max(MdfGoal.position)).where(MdfGoal.mdf_id == mdf_id))
    goal = MdfGoal(mdf_id=mdf_id, text=payload.text.strip(), position=(last or 0) + 1, created_by=user.id)
    db.add(goal)
    db.flush()
    _audit(db, mdf, user.id, AuditAction.create, f"Goal added: {goal.text}", {"goal": goal.text, "goal_event": "added"})
    db.commit()
    db.refresh(goal)
    return _goal_out(goal)


@router.patch("/{mdf_id}/goals/{goal_id}", response_model=GoalOut, dependencies=[Depends(verify_csrf)])
def update_goal(
    mdf_id: uuid.UUID,
    goal_id: uuid.UUID,
    payload: GoalUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> GoalOut:
    """Reword a goal, or mark it reached (with a note) or not reached again."""
    mdf = _mdf(db, mdf_id, writing=True)
    goal = db.get(MdfGoal, goal_id)
    if goal is None or goal.mdf_id != mdf_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Goal not found")
    if payload.text is not None and payload.text.strip() != goal.text:
        old = goal.text
        goal.text = payload.text.strip()
        _audit(db, mdf, user.id, AuditAction.update, f"Goal reworded: {goal.text}",
               {"goal": goal.text, "goal_event": "reworded", "text": {"old": old, "new": goal.text}})
    if payload.done is True and goal.done_at is None:
        goal.done_at = datetime.now(timezone.utc)
        goal.done_by = user.id
        goal.done_note = (payload.note or "").strip() or None
        _audit(db, mdf, user.id, AuditAction.update, f"Goal reached: {goal.text}" + (f" — {goal.done_note}" if goal.done_note else ""),
               {"goal": goal.text, "goal_event": "reached", "note": goal.done_note})
    elif payload.done is False and goal.done_at is not None:
        goal.done_at = goal.done_by = goal.done_note = None
        _audit(db, mdf, user.id, AuditAction.update, f"Goal reopened: {goal.text}" + (f" — {payload.note.strip()}" if payload.note and payload.note.strip() else ""),
               {"goal": goal.text, "goal_event": "reopened", "note": (payload.note or "").strip() or None})
    elif payload.done is None and payload.note is not None and goal.done_at is not None:
        goal.done_note = payload.note.strip() or None
    db.commit()
    db.refresh(goal)
    return _goal_out(goal)


@router.put("/{mdf_id}/goals/order", response_model=list[GoalOut], dependencies=[Depends(verify_csrf)])
def reorder_goals(
    mdf_id: uuid.UUID, payload: GoalOrder, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> list[GoalOut]:
    _mdf(db, mdf_id, writing=True)
    goals = {g.id: g for g in _goals(db, mdf_id)}
    if len(payload.ids) != len(set(payload.ids)) or set(payload.ids) != set(goals):
        raise HTTPException(status.HTTP_409_CONFLICT, "The goals have changed — reload and try again")
    for i, gid in enumerate(payload.ids):
        goals[gid].position = i
    db.commit()
    return [_goal_out(goals[gid]) for gid in payload.ids]


@router.delete("/{mdf_id}/goals/{goal_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_goal(
    mdf_id: uuid.UUID, goal_id: uuid.UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> None:
    mdf = _mdf(db, mdf_id, writing=True)
    goal = db.get(MdfGoal, goal_id)
    if goal is None or goal.mdf_id != mdf_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Goal not found")
    _audit(db, mdf, user.id, AuditAction.delete, f"Goal removed: {goal.text}",
           {"goal": goal.text, "goal_event": "removed", "was_reached": goal.done_at is not None})
    db.delete(goal)
    db.commit()


# --- Progress log ------------------------------------------------------------------


class LogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: str
    body: str
    author_id: uuid.UUID | None
    author_username: str | None = None
    created_at: datetime


class LogCreate(BaseModel):
    kind: Literal["progress", "release"] = "progress"
    body: str = Field(min_length=1, max_length=20000)


def _log_out(e: MdfLogEntry) -> LogOut:
    out = LogOut.model_validate(e)
    out.author_username = e.author.username if e.author else None
    return out


@router.get("/{mdf_id}/log", response_model=list[LogOut])
def list_log(mdf_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> list[LogOut]:
    _mdf(db, mdf_id)
    rows = db.scalars(select(MdfLogEntry).where(MdfLogEntry.mdf_id == mdf_id).order_by(MdfLogEntry.created_at.desc())).all()
    return [_log_out(e) for e in rows]


@router.post("/{mdf_id}/log", response_model=LogOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
def add_log(
    mdf_id: uuid.UUID, payload: LogCreate, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> LogOut:
    mdf = _mdf(db, mdf_id, writing=True)
    entry = MdfLogEntry(mdf_id=mdf_id, kind=payload.kind, body=payload.body.strip(), author_id=user.id)
    db.add(entry)
    db.flush()
    _audit(db, mdf, user.id, AuditAction.create, f"{payload.kind.capitalize()} log entry added",
           {"log": entry.body[:500], "log_kind": entry.kind})
    db.commit()
    db.refresh(entry)
    return _log_out(entry)


@router.delete("/{mdf_id}/log/{entry_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_log(
    mdf_id: uuid.UUID, entry_id: uuid.UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> None:
    """Only its author, or an Admin."""
    mdf = _mdf(db, mdf_id, writing=True)
    entry = db.get(MdfLogEntry, entry_id)
    if entry is None or entry.mdf_id != mdf_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Log entry not found")
    if entry.author_id != user.id and user.role != Role.admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only its author or an Admin can delete a log entry")
    _audit(db, mdf, user.id, AuditAction.delete, f"{entry.kind.capitalize()} log entry deleted",
           {"log": entry.body[:500], "log_kind": entry.kind})
    db.delete(entry)
    db.commit()


# --- Release notes ---------------------------------------------------------------------


class ReleaseNotesIn(BaseModel):
    text: str | None = Field(default=None, max_length=100_000)


def _version(db: Session, mdf_id: uuid.UUID, number: int) -> MdfVersion:
    v = db.scalar(select(MdfVersion).where(MdfVersion.mdf_id == mdf_id, MdfVersion.version_number == number))
    if v is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"MDF v{number} not found")
    return v


@router.put("/{mdf_id}/versions/{version_number}/release-notes", dependencies=[Depends(verify_csrf)])
def set_release_notes(
    mdf_id: uuid.UUID,
    version_number: int,
    payload: ReleaseNotesIn,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> dict:
    mdf = _mdf(db, mdf_id, writing=True)
    v = _version(db, mdf_id, version_number)
    new = (payload.text or "").strip() or None
    if new != v.release_notes:
        _audit(db, mdf, user.id, AuditAction.update, f"Release notes of v{version_number} edited",
               {"release_notes": {"old": v.release_notes, "new": new}, "version_number": version_number})
        v.release_notes = new
        v.release_notes_updated_at = datetime.now(timezone.utc)
        v.release_notes_updated_by = user.id
        db.commit()
    return {"version_number": version_number, "release_notes": v.release_notes, "release_notes_updated_at": v.release_notes_updated_at}


# --- Timeline -------------------------------------------------------------------------


def _versions(db: Session, mdf_id: uuid.UUID) -> list[MdfVersion]:
    return db.scalars(select(MdfVersion).where(MdfVersion.mdf_id == mdf_id).order_by(MdfVersion.version_number)).all()


def _status_moves(db: Session, mdf_id: uuid.UUID) -> list[AuditLog]:
    return db.scalars(
        select(AuditLog)
        .where(AuditLog.entity_id == mdf_id, AuditLog.entity_type == AuditEntityType.mdf.value, AuditLog.action == AuditAction.status_change)
        .order_by(AuditLog.created_at)
    ).all()


def _user(row) -> str | None:
    return row.actor.username if getattr(row, "actor", None) else None


# --- Summary between two versions (and the release notes document) -----------------


def last_release_version(db: Session, mdf_id: uuid.UUID, before: datetime | None = None) -> int | None:
    """The version that was the latest saved one when the MDF last moved to Released."""
    versions = _versions(db, mdf_id)
    moves = [m for m in _status_moves(db, mdf_id) if ((m.changes or {}).get("status") or {}).get("new") == "released"]
    if before is not None:
        moves = [m for m in moves if m.created_at < before]
    for move in reversed(moves):
        saved = [v.version_number for v in versions if v.created_at <= move.created_at]
        if saved:
            return saved[-1]
    return None


def build_summary(db: Session, mdf: Mdf, from_version: int | None, to_version: int | None) -> dict:
    versions = _versions(db, mdf.id)
    if not versions:
        raise HTTPException(status.HTTP_409_CONFLICT, "Nothing to summarize — the MDF has no saved version yet")
    by_number = {v.version_number: v for v in versions}
    to = by_number.get(to_version) if to_version else versions[-1]
    if to is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"MDF v{to_version} not found")
    if from_version is None:
        from_version = last_release_version(db, mdf.id, before=None)
        if from_version is not None and from_version >= to.version_number:
            # Released at this version already: since the release before it.
            earlier = [v.version_number for v in versions if v.version_number < to.version_number]
            from_version = last_release_version(db, mdf.id, before=to.created_at) if earlier else None
            if from_version is not None and from_version >= to.version_number:
                from_version = None
    frm = by_number.get(from_version) if from_version else None
    if from_version and frm is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"MDF v{from_version} not found")
    if frm is not None and frm.version_number >= to.version_number:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "'From' must be an earlier version than 'to'")

    start = frm.created_at if frm else None
    following = [v for v in versions if v.version_number > to.version_number]
    end = following[0].created_at if following else None

    def within(at: datetime) -> bool:
        return (start is None or at > start) and (end is None or at <= end)

    log = [
        e for e in db.scalars(select(MdfLogEntry).where(MdfLogEntry.mdf_id == mdf.id).order_by(MdfLogEntry.created_at))
        if within(e.created_at)
    ]
    moves = [m for m in _status_moves(db, mdf.id) if within(m.created_at)]
    goals = _goals(db, mdf.id)
    labels = statuses.labels(db, "mdf")
    customer = db.get(Customer, mdf.customer_id) if mdf.customer_id else None
    contents = [
        {
            "platform": link["platform_name"],
            "platform_version": link.get("platform_version_label") or link.get("platform_version_number"),
            "emitters": [
                {"name": el["emitter_name"], "version": el.get("emitter_version_number")}
                for el in sorted((link.get("platform_snapshot") or {}).get("links", []), key=lambda el: el["emitter_name"].lower())
            ],
        }
        for link in sorted(to.snapshot.get("links", []), key=lambda link: link["platform_name"].lower())
    ]
    return {
        "mdf": {
            "id": str(mdf.id),
            "name": mdf.name,
            "status": labels.get(mdf.status, mdf.status),
            "customer": customer.name if customer else None,
            "due_date": mdf.due_date,
            "release_date": mdf.release_date,
        },
        "from_version": frm.version_number if frm else None,
        "from_at": frm.created_at if frm else None,
        "to_version": to.version_number,
        "to_at": to.created_at,
        "versions": [
            {
                "version_number": v.version_number,
                "at": v.created_at,
                "by": v.created_by_username,
                "change_summary": v.change_summary,
                "release_notes": v.release_notes,
            }
            for v in versions
            if (frm is None or v.version_number > frm.version_number) and v.version_number <= to.version_number
        ],
        "changes": mdf_change_summary(db, frm.snapshot if frm else {}, to.snapshot),
        "contents": contents,
        "goals": [
            {"text": g.text, "done": g.done_at is not None, "done_at": g.done_at, "note": g.done_note,
             "by": g.doer.username if g.doer else None, "in_period": bool(g.done_at and within(g.done_at))}
            for g in goals
        ],
        "status_moves": [
            {"at": m.created_at, "by": _user(m), "from": labels.get(((m.changes or {}).get("status") or {}).get("old"), ""),
             "to": labels.get(((m.changes or {}).get("status") or {}).get("new"), ""), "summary": m.summary}
            for m in moves
        ],
        "log": [
            {"kind": e.kind, "at": e.created_at, "by": e.author.username if e.author else None, "text": e.body} for e in log
        ],
        "last_release_version": last_release_version(db, mdf.id),
    }


@router.get("/{mdf_id}/summary")
def summary(
    mdf_id: uuid.UUID,
    from_version: int | None = None,
    to_version: int | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> dict:
    """What changed between two saved versions (by default: since the last
    release, up to the latest) — with release notes, goals, status moves and
    log entries from that stretch."""
    return build_summary(db, _mdf(db, mdf_id), from_version, to_version)


def _day(value) -> str:
    if value is None:
        return "—"
    if isinstance(value, datetime):
        return value.strftime("%d.%m.%Y %H:%M")
    if isinstance(value, date):
        return value.strftime("%d.%m.%Y")
    return str(value)


def summary_document(s: dict) -> bytes:
    m = s["mdf"]
    span = (
        f"Changes from v{s['from_version']} ({_day(s['from_at'])}) to v{s['to_version']} ({_day(s['to_at'])})"
        if s["from_version"]
        else f"Everything up to v{s['to_version']} ({_day(s['to_at'])})"
    )
    blocks = [
        Block("title", f"{m['name']} — release notes v{s['to_version']}"),
        Block("meta", " · ".join(x for x in [
            f"Status: {m['status']}",
            f"Customer: {m['customer']}" if m["customer"] else None,
            f"Due {_day(m['due_date'])}" if m["due_date"] else None,
            f"Release date {_day(m['release_date'])}" if m["release_date"] else None,
            f"Written {datetime.now(timezone.utc).strftime('%d.%m.%Y')}",
        ] if x)),
        Block("meta", span),
    ]
    notes = [v for v in s["versions"] if v["release_notes"]]
    blocks.append(Block("h1", "Release notes"))
    if notes:
        for v in reversed(notes):
            if len(notes) > 1:
                blocks.append(Block("h2", f"v{v['version_number']} — {_day(v['at'])}"))
            blocks.append(Block("p", v["release_notes"]))
    else:
        blocks.append(Block("meta", "No release notes written for these versions."))

    blocks.append(Block("h1", "What changed"))
    if s["changes"]:
        blocks.append(Block("table", rows=[["What", "Change", "Before", "After"]] + [
            [c["scope"], c["label"], c["old_value"] or "", c["new_value"] or ""] for c in s["changes"]
        ]))
    else:
        blocks.append(Block("meta", "No changes to the pins."))
    if len(s["versions"]) > 0:
        blocks.append(Block("h2", "Versions saved"))
        for v in s["versions"]:
            blocks.append(Block("bullet", f"v{v['version_number']} — {_day(v['at'])}" + (f" by {v['by']}" if v["by"] else "")
                                + (f": {v['change_summary']}" if v["change_summary"] else "")))

    blocks.append(Block("h1", "Goals"))
    if s["goals"]:
        for g in s["goals"]:
            mark = "✔" if g["done"] else "☐"
            line = f"{mark} {g['text']}"
            if g["done"]:
                line += f" — reached {_day(g['done_at'])}" + (f" by {g['by']}" if g["by"] else "") + (f": {g['note']}" if g["note"] else "")
            blocks.append(Block("p", line))
    else:
        blocks.append(Block("meta", "No goals set."))

    if s["status_moves"]:
        blocks.append(Block("h1", "Status"))
        for mv in s["status_moves"]:
            blocks.append(Block("bullet", f"{_day(mv['at'])}: {mv['from']} → {mv['to']}" + (f" ({mv['by']})" if mv["by"] else "")))

    if s["log"]:
        blocks.append(Block("h1", "Progress log"))
        for e in s["log"]:
            blocks.append(Block("h2", f"{'Release' if e['kind'] == 'release' else 'Progress'} — {_day(e['at'])}" + (f" · {e['by']}" if e["by"] else "")))
            blocks.append(Block("p", e["text"]))

    blocks.append(Block("h1", f"Contents of v{s['to_version']}"))
    rows = [["Platform", "Platform version", "Emitter", "Emitter version"]]
    for p in s["contents"]:
        if not p["emitters"]:
            rows.append([p["platform"], f"v{p['platform_version']}", "—", ""])
        for i, e in enumerate(p["emitters"]):
            rows.append([p["platform"] if i == 0 else "", f"v{p['platform_version']}" if i == 0 else "", e["name"], f"v{e['version']}"])
    blocks.append(Block("table", rows=rows) if len(rows) > 1 else Block("meta", "Nothing pinned."))
    return write_docx(blocks)


@router.get("/{mdf_id}/summary.docx")
def summary_docx(
    mdf_id: uuid.UUID,
    from_version: int | None = None,
    to_version: int | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> Response:
    """The same summary as a Word document: the release notes."""
    mdf = _mdf(db, mdf_id)
    s = build_summary(db, mdf, from_version, to_version)
    name = f"{mdf.name} release notes v{s['to_version']}.docx"
    return Response(content=summary_document(s), media_type=DOCX, headers={"Content-Disposition": attachment_disposition(name)})
