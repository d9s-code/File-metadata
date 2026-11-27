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
from app.services import app_settings, llm_client, statuses
from app.services.audit_service import record_audit
from app.services.change_log import DETAILS, GROUPS, change_log
from app.services.change_notes import COUNTS_DEFAULT, change_notes
from app.services.docx_writer import Block, write_docx
from app.services.release_tables import (
    EMITTER_COLUMNS,
    EMITTER_DEFAULT,
    PLATFORM_COLUMNS,
    PLATFORM_DEFAULT,
    ROWS,
    release_tables,
    table_block,
)

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


def previous_mdf_version(db: Session, mdf: Mdf) -> tuple[Mdf, MdfVersion] | None:
    """The MDF this one follows and the version of it (set when it was made
    with New MDF from this one, or under Edit details), if it still has it."""
    if not mdf.based_on_mdf_id or not mdf.based_on_version_number:
        return None
    prev = db.get(Mdf, mdf.based_on_mdf_id)
    version = (
        db.query(MdfVersion)
        .filter(MdfVersion.mdf_id == mdf.based_on_mdf_id, MdfVersion.version_number == mdf.based_on_version_number)
        .one_or_none()
    )
    return (prev, version) if prev is not None and version is not None else None


SummaryBase = Literal["start", "previous"]


def build_summary(
    db: Session,
    mdf: Mdf,
    from_version: int | None,
    to_version: int | None,
    base: SummaryBase | None = None,
    counts: dict[str, bool] | None = None,
    detail: str = "full",
    group: str = "change",
) -> dict:
    """`base` "start": everything up to `to_version`; "previous": the changes
    since the MDF this one follows. Otherwise from `from_version`, or by
    default since this MDF's last release — or, before it has one, since the
    MDF it follows. `counts`: what counts in the change notes, else the
    admin's setting. `detail` and `group`: how the change log reads (see
    change_log)."""
    versions = _versions(db, mdf.id)
    if not versions:
        raise HTTPException(status.HTTP_409_CONFLICT, "Nothing to summarize — the MDF has no saved version yet")
    by_number = {v.version_number: v for v in versions}
    to = by_number.get(to_version) if to_version else versions[-1]
    if to is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"MDF v{to_version} not found")
    previous = previous_mdf_version(db, mdf)
    if base == "previous" and previous is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "This MDF doesn't follow another MDF — set one under Edit details")
    if base is not None:
        from_version = None
    elif from_version is None:
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
    # Changes since the MDF this one follows: asked for, or by default when
    # this MDF has no release of its own to count from yet.
    from_previous = previous is not None and (base == "previous" or (base is None and from_version is None and frm is None))
    base_snapshot = previous[1].snapshot if from_previous else (frm.snapshot if frm else {})

    labels = statuses.labels(db, "mdf")
    customer = db.get(Customer, mdf.customer_id) if mdf.customer_id else None
    contents = [
        {
            "platform": link["platform_name"],
            "platform_version": link.get("platform_version_label") or link.get("platform_version_number"),
            "emitters": [
                {
                    "name": el["emitter_name"],
                    "designation": (el.get("emitter_snapshot") or {}).get("designation"),
                    "version": el.get("emitter_version_number"),
                }
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
        # Set when the changes are counted from the MDF this one follows.
        "from_mdf": (
            {"id": str(previous[0].id), "name": previous[0].name, "version": previous[1].version_number, "at": previous[1].created_at}
            if from_previous
            else None
        ),
        "previous_mdf": (
            {"id": str(previous[0].id), "name": previous[0].name, "version": previous[1].version_number} if previous else None
        ),
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
        # Major changes only — see change_notes.
        "change_notes": change_notes(base_snapshot, to.snapshot, counts or app_settings.change_notes_counts(db)),
        # The same, as it reads at the detail and grouping asked for — what the document writes.
        "change_log": change_log(base_snapshot, to.snapshot, counts or app_settings.change_notes_counts(db), detail, group),
        "contents": contents,
        # Every Platform and Emitter in the later version, for the tables the document can have.
        "tables": release_tables(
            base_snapshot,
            to.snapshot,
            counts or app_settings.change_notes_counts(db),
            statuses.labels(db, "platform"),
            statuses.labels(db, "emitter"),
        ),
        "last_release_version": last_release_version(db, mdf.id),
    }


@router.get("/{mdf_id}/summary")
def summary(
    mdf_id: uuid.UUID,
    from_version: int | None = None,
    to_version: int | None = None,
    base: SummaryBase | None = None,
    counts: str | None = None,
    detail: str = "full",
    group: str = "change",
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> dict:
    """The change notes between two saved versions — or since the MDF this
    one follows (by default: since the last release, else since that MDF) —
    with the release notes written for that stretch and the contents of the
    later version. Major changes only: see change_notes. Goals, status moves
    and the progress log stay on the Plan and Audit tabs.

    `counts` previews other rules for what counts: the rules that are on,
    comma-separated (blank: none), in place of the admin's setting.
    `detail` (full, names, counts, sentences) and `group` (change,
    platform): how `change_log` reads."""
    _check_layout(detail, group)
    return build_summary(db, _mdf(db, mdf_id), from_version, to_version, base, _preview_counts(counts), detail, group)


def _check_layout(detail: str, group: str) -> None:
    if detail not in DETAILS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"detail: one of {', '.join(DETAILS)}")
    if group not in GROUPS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"group: one of {', '.join(GROUPS)}")


def _preview_counts(counts: str | None) -> dict[str, bool] | None:
    if counts is None:
        return None
    on = {c.strip() for c in counts.split(",") if c.strip()}
    unknown = sorted(on - COUNTS_DEFAULT.keys())
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown change-note rule(s): {', '.join(unknown)}")
    return {k: k in on for k in COUNTS_DEFAULT}


def _day(value) -> str:
    if value is None:
        return "—"
    if isinstance(value, datetime):
        return value.strftime("%d.%m.%Y %H:%M")
    if isinstance(value, date):
        return value.strftime("%d.%m.%Y")
    return str(value)


# The parts of the release-notes document that can go in or be left out
# (the change log always does); DEFAULT_PARTS go in unless asked otherwise.
PARTS = ("meta", "release_notes", "platforms", "emitters", "contents")
DEFAULT_PARTS = ("meta", "release_notes", "contents")
# A progress note's.
PROGRESS_PARTS = ("meta", "goals", "progress_log", "emitter_progress", "changes", "platforms", "emitters")
PROGRESS_DEFAULT = ("meta", "goals", "progress_log", "emitter_progress", "changes")
KINDS = ("release", "progress")
# The change log's columns in the document, by their first word: what changed, widest.
_COLUMN_WIDTHS = {"Change": 1.1, "Type": 1.0, "Name": 2.2, "Platform": 1.8, "Emitter": 2.2, "Details": 4.2}


class Tables(BaseModel):
    """The Platforms and Emitters tables: their columns (keys of
    PLATFORM_COLUMNS and EMITTER_COLUMNS), and every row or only those
    added or updated."""

    platform_columns: list[str] = Field(default_factory=lambda: list(PLATFORM_DEFAULT))
    emitter_columns: list[str] = Field(default_factory=lambda: list(EMITTER_DEFAULT))
    rows: str = "all"


def summary_document(s: dict, parts: tuple[str, ...] = DEFAULT_PARTS, release_notes_text: str | None = None, tables: Tables | None = None) -> bytes:
    """The release notes as a Word document — see document_blocks."""
    return write_docx(document_blocks(s, parts, release_notes_text, tables))


def _span(s: dict, show_version: bool) -> str:
    """The versions the document covers — without the MDF's version numbers, by date only."""

    def v(n) -> str:
        return f"v{n} " if show_version else ""

    to = f"{v(s['to_version'])}({_day(s['to_at'])})" if show_version else _day(s["to_at"])
    if s.get("from_mdf"):
        prev = s["from_mdf"]
        start = f"{prev['name']} {v(prev['version'])}({_day(prev['at'])})" if show_version else f"{prev['name']} ({_day(prev['at'])})"
        return f"Changes from {start} to {to}"
    if s["from_version"]:
        start = f"{v(s['from_version'])}({_day(s['from_at'])})" if show_version else _day(s["from_at"])
        return f"Changes from {start} to {to}"
    return f"Everything up to {to}"


def _due(m: dict) -> str | None:
    """"Due 31.12.2026 (in 34 days)" / "(3 days overdue)"."""
    due = m.get("due_date")
    if not due:
        return None
    days = (due - datetime.now(timezone.utc).date()).days
    when = "today" if days == 0 else f"in {days} day{'' if days == 1 else 's'}" if days > 0 else f"{-days} day{'' if days == -1 else 's'} overdue"
    return f"Due {_day(due)} ({when})"


def _change_log_blocks(s: dict) -> list[Block]:
    blocks = []
    for b in s["change_log"]["blocks"]:
        if b["type"] == "empty":
            blocks.append(Block("meta", b["text"]))
        elif b["type"] == "heading":
            blocks.append(Block("h2", b["text"]))
        elif b["type"] == "paragraph":
            blocks.append(Block("p", b["text"]))
        elif b["type"] == "table":
            rows = [b["columns"], *[r["cells"] for r in b["rows"]]]
            widths = [_COLUMN_WIDTHS.get(c.split(" ")[0], 1.0) for c in b["columns"]]
            blocks.append(Block("table", rows=rows, marks=[r["mark"] for r in b["rows"]], mark_column=b["mark_column"], widths=widths))
        else:
            blocks.append(Block("bullet", b["text"] + (": " + "; ".join(b["items"]) if b["items"] else "")))
    return blocks


def _table_blocks(s: dict, parts: tuple[str, ...], tables: Tables, where: str) -> list[Block]:
    blocks = []
    for part, title, columns in (("platforms", "Platforms", PLATFORM_COLUMNS), ("emitters", "Emitters", EMITTER_COLUMNS)):
        if part not in parts:
            continue
        shown = tables.platform_columns if part == "platforms" else tables.emitter_columns
        t = table_block(s["tables"][part], columns, shown, tables.rows)
        blocks.append(Block("h1", f"{title}{' added or updated' if tables.rows == 'changed' else ''}{where}"))
        if t is None:
            blocks.append(Block("meta", f"No {title} added or updated." if tables.rows == "changed" else f"No {title}."))
        else:
            blocks.append(
                Block("table", rows=[t["columns"], *t["rows"]], marks=t["marks"], mark_column=t["mark_column"], widths=t["widths"], font_pt=t["font_pt"])
            )
    return blocks


def _progress_blocks(s: dict, parts: tuple[str, ...], progress: dict) -> list[Block]:
    """A progress note's own parts: goals, the progress log, Emitter progress per Platform."""
    blocks = []
    if "goals" in parts:
        blocks.append(Block("h1", "Goals"))
        goals = progress["goals"]
        if not goals:
            blocks.append(Block("meta", "No goals set."))
        else:
            done = sum(1 for g in goals if g["done"])
            blocks.append(Block("meta", f"{done} of {len(goals)} done"))
            rows = [["Goal", "Done", "Note"]] + [
                [g["text"], f"Done {_day(g['done_at'].date())}" if g["done"] else "Open", g["note"] or ""] for g in goals
            ]
            blocks.append(Block("table", rows=rows, marks=["added" if g["done"] else None for g in goals], mark_column=1, widths=[5, 2.4, 4]))
    if "progress_log" in parts:
        since = progress["since"]
        blocks.append(Block("h1", f"Progress since the last release ({_day(since.date())})" if since else "Progress"))
        log = progress["log"]
        if not log:
            blocks.append(Block("meta", "Nothing logged since." if since else "Nothing logged yet."))
        else:
            rows = [["Date", "By", "Progress"]] + [[_day(e["at"].date()), e["by"] or "—", e["text"]] for e in log]
            blocks.append(Block("table", rows=rows, marks=[None] * len(log), widths=[1.4, 1.4, 7]))
    if "emitter_progress" in parts:
        ep = progress["emitter_progress"]
        blocks.append(Block("h1", "Emitter progress"))
        overall = ep["overall"]
        if overall["percent"] is None:
            blocks.append(Block("meta", "No Emitters pinned."))
        else:
            blocks.append(
                Block("meta", f"Overall {overall['percent']}% of the way to Operational — {overall['emitters']} Emitters: {overall['by_status']}")
            )
            rows = [["Platform", "Emitters", "Progress", "Status"]] + [
                [p["platform"], str(p["emitters"]), "—" if p["percent"] is None else f"{p['percent']}%", p["by_status"]] for p in ep["platforms"]
            ]
            marks = ["added" if p["percent"] == 100 else None for p in ep["platforms"]]
            blocks.append(Block("table", rows=rows, marks=marks, mark_column=2, widths=[3, 1.3, 1.5, 5]))
    return blocks


def document_blocks(
    s: dict,
    parts: tuple[str, ...] = DEFAULT_PARTS,
    release_notes_text: str | None = None,
    tables: Tables | None = None,
    kind: str = "release",
    show_version: bool = True,
    progress: dict | None = None,
) -> list[Block]:
    """The document's blocks — what the Word file writes and the preview
    page draws. `kind` "release": the release notes; "progress": a progress
    note (with `progress`, see progress_note). `parts`: what goes in (see
    RELEASE_PARTS and PROGRESS_PARTS; a release's change log always does).
    `release_notes_text`: in place of the release notes written for the
    versions — a plain-language draft, edited. `tables`: their columns and
    rows. `show_version`: the MDF's version numbers, or dates only."""
    tables = tables or Tables()
    m = s["mdf"]
    version = f" v{s['to_version']}" if show_version else ""
    written = f"Written {datetime.now(timezone.utc).strftime('%d.%m.%Y')}"
    if kind == "progress":
        blocks = [Block("title", f"{m['name']} — progress note")]
        if "meta" in parts:
            blocks += [
                Block("meta", " · ".join(x for x in [
                    f"Status: {m['status']}",
                    f"Customer: {m['customer']}" if m["customer"] else None,
                    _due(m),
                    written,
                ] if x)),
                Block("meta", f"Of v{s['to_version']}, saved {_day(s['to_at'])}" if show_version else f"As saved {_day(s['to_at'])}"),
            ]  # fmt: skip
        blocks += _progress_blocks(s, parts, progress or {"goals": [], "log": [], "since": None, "emitter_progress": {"platforms": [], "overall": {"percent": None}}})
        if "changes" in parts:
            blocks.append(Block("h1", "Changes so far"))
            blocks.append(Block("meta", _span(s, show_version)))
            blocks += _change_log_blocks(s)
        blocks += _table_blocks(s, parts, tables, version and f" in{version}")
        return blocks

    blocks = [Block("title", f"{m['name']} — release notes{version}")]
    if "meta" in parts:
        blocks += [
            Block("meta", " · ".join(x for x in [
                f"Status: {m['status']}",
                f"Customer: {m['customer']}" if m["customer"] else None,
                f"Due {_day(m['due_date'])}" if m["due_date"] else None,
                f"Release date {_day(m['release_date'])}" if m["release_date"] else None,
                written,
            ] if x)),
            Block("meta", _span(s, show_version)),
        ]  # fmt: skip
    if "release_notes" in parts:
        blocks.append(Block("h1", "Release notes"))
        if release_notes_text is not None and release_notes_text.strip():
            blocks += [Block("p", para.strip()) for para in release_notes_text.strip().split("\n\n") if para.strip()]
        else:
            notes = [v for v in s["versions"] if v["release_notes"]]
            if notes:
                for v in reversed(notes):
                    if len(notes) > 1:
                        blocks.append(Block("h2", f"v{v['version_number']} — {_day(v['at'])}" if show_version else _day(v["at"])))
                    blocks.append(Block("p", v["release_notes"]))
            else:
                blocks.append(Block("meta", "No release notes written for these versions."))

    blocks.append(Block("h1", "Change notes"))
    blocks += _change_log_blocks(s)
    blocks += _table_blocks(s, parts, tables, version and f" in{version}")

    if "contents" in parts:
        blocks.append(Block("h1", f"Contents of{version}" if show_version else "Contents"))
        # Emitter versions only in full detail.
        versions = s.get("change_log", {}).get("detail", "full") == "full"
        rows = [["Platform", "Platform version", "Emitter"] + (["Emitter version"] if versions else [])]
        for p in s["contents"]:
            if not p["emitters"]:
                rows.append([p["platform"], f"v{p['platform_version']}", "—"] + ([""] if versions else []))
            for i, e in enumerate(p["emitters"]):
                name = f"{e['designation']} — {e['name']}" if e.get("designation") else e["name"]
                rows.append(
                    [p["platform"] if i == 0 else "", f"v{p['platform_version']}" if i == 0 else "", name]
                    + ([f"v{e['version']}"] if versions else [])
                )
        blocks.append(Block("table", rows=rows) if len(rows) > 1 else Block("meta", "Nothing pinned."))
    return blocks


def _parts(parts: str | None, kind: str = "release") -> tuple[str, ...]:
    if parts is None:
        return PROGRESS_DEFAULT if kind == "progress" else DEFAULT_PARTS
    on = tuple(p.strip() for p in parts.split(",") if p.strip())
    unknown = sorted(set(on) - set(PROGRESS_PARTS if kind == "progress" else PARTS))
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown part(s): {', '.join(unknown)}")
    return on


@router.get("/{mdf_id}/summary.docx")
def summary_docx(
    mdf_id: uuid.UUID,
    from_version: int | None = None,
    to_version: int | None = None,
    base: SummaryBase | None = None,
    detail: str = "full",
    group: str = "change",
    parts: str | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> Response:
    """The same summary as a Word document: the release notes. `detail`,
    `group`: how the change log reads; `parts`: which of meta,
    release_notes and contents go in (comma-separated; all by default)."""
    _check_layout(detail, group)
    mdf = _mdf(db, mdf_id)
    s = build_summary(db, mdf, from_version, to_version, base, None, detail, group)
    return _docx_response(mdf, s, _parts(parts), None)


class SummaryDocument(BaseModel):
    """A release-notes document (or a progress note: `kind`), laid out as
    asked — with, optionally, the release notes in plain words (an edited
    draft) in place of those written, and the MDF's version numbers or not."""

    kind: Literal["release", "progress"] = "release"
    show_version: bool = True
    from_version: int | None = None
    to_version: int | None = None
    base: SummaryBase | None = None
    detail: str = "full"
    group: str = "change"
    # None: the kind's own default parts.
    parts: list[str] | None = None
    release_notes_text: str | None = Field(default=None, max_length=20000)
    tables: Tables = Field(default_factory=Tables)


def _check_tables(t: Tables) -> None:
    for asked, columns, what in ((t.platform_columns, PLATFORM_COLUMNS, "Platform"), (t.emitter_columns, EMITTER_COLUMNS, "Emitter")):
        unknown = sorted(set(asked) - columns.keys())
        if unknown:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown {what} column(s): {', '.join(unknown)}")
    if t.rows not in ROWS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"rows: one of {', '.join(ROWS)}")


def _laid_out(db: Session, mdf_id: uuid.UUID, payload: SummaryDocument) -> tuple[list[Block], str]:
    """The document asked for: its blocks and its file name."""
    _check_layout(payload.detail, payload.group)
    _check_tables(payload.tables)
    parts = _parts(None if payload.parts is None else ",".join(payload.parts), payload.kind)
    mdf = _mdf(db, mdf_id)
    s = build_summary(db, mdf, payload.from_version, payload.to_version, payload.base, None, payload.detail, payload.group)
    progress = None
    if payload.kind == "progress":
        from app.services.progress_note import progress_data

        progress = progress_data(db, mdf.id, _version(db, mdf.id, s["to_version"]).snapshot)
    blocks = document_blocks(s, parts, payload.release_notes_text, payload.tables, payload.kind, payload.show_version, progress)
    what = "progress note" if payload.kind == "progress" else "release notes"
    stamp = f"v{s['to_version']}" if payload.show_version else datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return blocks, f"{mdf.name} {what} {stamp}.docx"


@router.post("/{mdf_id}/summary.docx", dependencies=[Depends(verify_csrf)])
def summary_docx_with(
    mdf_id: uuid.UUID, payload: SummaryDocument, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> Response:
    """The release notes (or a progress note) as a Word document, laid out as asked."""
    blocks, name = _laid_out(db, mdf_id, payload)
    return Response(content=write_docx(blocks), media_type=DOCX, headers={"Content-Disposition": attachment_disposition(name)})


@router.post("/{mdf_id}/summary/preview", dependencies=[Depends(verify_csrf)])
def summary_preview(
    mdf_id: uuid.UUID, payload: SummaryDocument, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> dict:
    """The release notes (or a progress note) laid out as asked, as the
    document's blocks — the preview page draws exactly what the Word file
    will hold."""
    blocks, name = _laid_out(db, mdf_id, payload)
    return {
        "file_name": name,
        "blocks": [
            {
                "kind": b.kind,
                "text": b.text,
                "rows": b.rows,
                "marks": b.marks,
                "mark_column": b.mark_column,
                "widths": b.widths,
                "font_pt": b.font_pt,
            }
            for b in blocks
        ],
    }


@router.get("/{mdf_id}/summary/columns")
def summary_columns(mdf_id: uuid.UUID, _=Depends(require_role(Role.viewer))) -> dict:
    """What the Platforms and Emitters tables can show, and what they show to start."""
    return {
        "platforms": {"columns": PLATFORM_COLUMNS, "default": list(PLATFORM_DEFAULT)},
        "emitters": {"columns": EMITTER_COLUMNS, "default": list(EMITTER_DEFAULT)},
    }


class PlainDraftAsk(BaseModel):
    from_version: int | None = None
    to_version: int | None = None
    base: SummaryBase | None = None


@router.post("/{mdf_id}/summary/plain-draft", dependencies=[Depends(verify_csrf)])
def summary_plain_draft(
    mdf_id: uuid.UUID, payload: PlainDraftAsk, db: Session = Depends(get_db), user=Depends(require_role(Role.viewer))
) -> dict:
    """The summary's release notes and change notes rewritten in plain words
    by the language model — a draft to edit, kept nowhere."""
    from app.services.release_notes_ai import plain_draft

    s = build_summary(db, _mdf(db, mdf_id), payload.from_version, payload.to_version, payload.base)
    try:
        return plain_draft(s, user)
    except llm_client.LlmNotConfigured as err:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(err)) from err
    except llm_client.LlmError as err:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(err)) from err


def _docx_response(mdf: Mdf, s: dict, parts: tuple[str, ...], text: str | None, tables: Tables | None = None) -> Response:
    name = f"{mdf.name} release notes v{s['to_version']}.docx"
    return Response(
        content=summary_document(s, parts, text, tables), media_type=DOCX, headers={"Content-Disposition": attachment_disposition(name)}
    )
