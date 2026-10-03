"""Tasks — to-dos for yourself, for someone else on the team, or for anyone to
pick up, optionally about one Emitter, Platform or MDF — and the people they
(and Emitters) can be assigned to."""

from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import has_role, require_role
from app.models.emitter import Emitter
from app.models.mdf import Mdf
from app.models.platform import Platform
from app.models.task import Task, TaskNote
from app.models.user import User
from app.schemas.task import (
    AssignedEmitterOut,
    MyWorkOut,
    PersonOut,
    TaskCreate,
    TaskNoteCreate,
    TaskNoteOut,
    TaskOut,
    TaskUpdate,
)
from app.services.audit_service import record_audit, snapshot

router = APIRouter(prefix="/tasks", tags=["tasks"])
people_router = APIRouter(prefix="/people", tags=["tasks"])

_ENTITY_MODELS = {"emitter": Emitter, "platform": Platform, "mdf": Mdf}
#: Done tasks listed at most — the newest.
DONE_LIMIT = 200


@people_router.get("", response_model=list[PersonOut])
def list_people(db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> list[PersonOut]:
    """Everyone active, for the "assign to" pickers."""
    users = db.query(User).filter(User.is_active.is_(True)).order_by(func.lower(User.username)).all()
    return [PersonOut(id=u.id, username=u.username, role=u.role.value) for u in users]


def active_user(db: Session, user_id: UUID | None, *, editors_only: bool = False) -> User | None:
    """The user a task or Emitter is being assigned to — must exist and be active
    (and, for an Emitter, able to edit it)."""
    if user_id is None:
        return None
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That person isn't an active user")
    if editors_only and not has_role(user, Role.editor):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"{user.username} is a viewer, so can't edit an Emitter"
        )
    return user


def to_out(db: Session, tasks: list[Task]) -> list[TaskOut]:
    """Tasks with the names of the people and the item they're about."""
    user_ids = {uid for t in tasks for uid in (t.assignee_id, t.created_by_id, t.done_by_id) if uid}
    names = dict(db.query(User.id, User.username).filter(User.id.in_(user_ids)).all()) if user_ids else {}
    items: dict[tuple[str, UUID], tuple[str, bool]] = {}
    for kind, model in _ENTITY_MODELS.items():
        ids = {t.entity_id for t in tasks if t.entity_type == kind and t.entity_id}
        if ids:
            for id_, name, deleted in db.query(model.id, model.name, model.is_deleted).filter(model.id.in_(ids)):
                items[(kind, id_)] = (name, deleted)
    note_counts = (
        dict(
            db.query(TaskNote.task_id, func.count())
            .filter(TaskNote.task_id.in_([t.id for t in tasks]))
            .group_by(TaskNote.task_id)
            .all()
        )
        if tasks
        else {}
    )
    out = []
    for t in tasks:
        name, deleted = items.get((t.entity_type, t.entity_id), (None, t.entity_id is not None))
        out.append(
            TaskOut(
                id=t.id,
                title=t.title,
                notes=t.notes,
                assignee_id=t.assignee_id,
                assignee_username=names.get(t.assignee_id),
                created_by_id=t.created_by_id,
                created_by_username=names.get(t.created_by_id),
                due_date=t.due_date,
                done_at=t.done_at,
                done_by_username=names.get(t.done_by_id),
                entity_type=t.entity_type,
                entity_id=t.entity_id,
                entity_name=name,
                entity_deleted=deleted,
                note_count=note_counts.get(t.id, 0),
                created_at=t.created_at,
                updated_at=t.updated_at,
            )
        )
    return out


def _open_order(q):
    # Soonest due first (undated last), then newest.
    return q.order_by(Task.due_date.asc().nulls_last(), Task.created_at.desc())


@router.get("", response_model=list[TaskOut])
def list_tasks(
    assignee: str | None = Query(None, description="'me', 'none' (anyone can pick it up), or a user id"),
    created_by: str | None = Query(None, description="'me' or a user id"),
    state: Literal["open", "done", "all"] = "open",
    entity_type: Literal["emitter", "platform", "mdf"] | None = None,
    entity_id: UUID | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.viewer)),
) -> list[TaskOut]:
    q = db.query(Task)

    def who(value: str):
        if value == "me":
            return user.id
        try:
            return UUID(value)
        except ValueError:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Not a user: {value!r}")

    if assignee == "none":
        q = q.filter(Task.assignee_id.is_(None))
    elif assignee:
        q = q.filter(Task.assignee_id == who(assignee))
    if created_by:
        q = q.filter(Task.created_by_id == who(created_by))
    if entity_type:
        q = q.filter(Task.entity_type == entity_type)
    if entity_id:
        q = q.filter(Task.entity_id == entity_id)
    if state == "open":
        q = _open_order(q.filter(Task.done_at.is_(None)))
    elif state == "done":
        q = q.filter(Task.done_at.is_not(None)).order_by(Task.done_at.desc()).limit(DONE_LIMIT)
    else:
        q = q.order_by(Task.done_at.is_not(None), Task.due_date.asc().nulls_last(), Task.created_at.desc())
    return to_out(db, q.all())


@router.get("/my-work", response_model=MyWorkOut)
def my_work(db: Session = Depends(get_db), user: User = Depends(require_role(Role.viewer))) -> MyWorkOut:
    """Your open tasks, the Emitters assigned to you, and how many tasks nobody has taken."""
    tasks = _open_order(db.query(Task).filter(Task.assignee_id == user.id, Task.done_at.is_(None))).all()
    emitters = (
        db.query(Emitter)
        .filter(Emitter.assignee_id == user.id, Emitter.is_deleted.is_(False))
        .order_by(func.lower(Emitter.name))
        .all()
    )
    open_counts = dict(
        db.query(Task.entity_id, func.count())
        .filter(Task.entity_type == "emitter", Task.entity_id.in_([e.id for e in emitters]), Task.done_at.is_(None))
        .group_by(Task.entity_id)
        .all()
    ) if emitters else {}
    holders = {e.checked_out_by_id for e in emitters if e.checked_out_by_id}
    names = dict(db.query(User.id, User.username).filter(User.id.in_(holders)).all()) if holders else {}
    unassigned = db.query(func.count(Task.id)).filter(Task.assignee_id.is_(None), Task.done_at.is_(None)).scalar()
    return MyWorkOut(
        tasks=to_out(db, tasks),
        emitters=[
            AssignedEmitterOut(
                id=e.id,
                name=e.name,
                status=e.status.value,
                checked_out_by_username=names.get(e.checked_out_by_id),
                open_tasks=open_counts.get(e.id, 0),
            )
            for e in emitters
        ],
        unassigned_open=unassigned,
    )


def _audit(db: Session, actor: User, action: AuditAction, task: Task, summary: str) -> None:
    record_audit(
        db,
        actor_id=actor.id,
        action=action,
        entity_type=AuditEntityType.task.value,
        entity_id=task.id,
        summary=summary,
        emitter_id=task.entity_id if task.entity_type == "emitter" else None,
    )


def _for(user: User | None) -> str:
    return f"for {user.username}" if user else "for anyone to pick up"


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
def create_task(
    payload: TaskCreate, db: Session = Depends(get_db), user: User = Depends(require_role(Role.editor))
) -> TaskOut:
    assignee = active_user(db, payload.assignee_id)
    if (payload.entity_type is None) != (payload.entity_id is None):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Give both what the task is about and its id, or neither")
    if payload.entity_type:
        item = db.get(_ENTITY_MODELS[payload.entity_type], payload.entity_id)
        if item is None or item.is_deleted:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"That {payload.entity_type} doesn't exist")
    task = Task(
        title=payload.title,
        notes=payload.notes or None,
        assignee_id=payload.assignee_id,
        created_by_id=user.id,
        due_date=payload.due_date,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
    )
    db.add(task)
    db.flush()
    _audit(db, user, AuditAction.create, task, f"Created task '{task.title}' {_for(assignee)}")
    db.commit()
    db.refresh(task)
    return to_out(db, [task])[0]


def _get(db: Session, task_id: UUID) -> Task:
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    return task


@router.patch("/{task_id}", response_model=TaskOut, dependencies=[Depends(verify_csrf)])
def update_task(
    task_id: UUID, payload: TaskUpdate, db: Session = Depends(get_db), user: User = Depends(require_role(Role.viewer))
) -> TaskOut:
    """Editors can change anything; whoever it's assigned to can always mark it done or not."""
    task = _get(db, task_id)
    sent = payload.model_fields_set
    if not has_role(user, Role.editor) and not (sent <= {"done"} and task.assignee_id == user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only editors can change tasks — you can mark your own done")
    summaries = []
    if "title" in sent and payload.title is not None and payload.title.strip() != task.title:
        summaries.append(f"Renamed task '{task.title}' to '{payload.title.strip()}'")
        task.title = payload.title.strip()
    if "notes" in sent and (payload.notes or None) != task.notes:
        task.notes = payload.notes or None
        summaries.append(f"Edited the notes on task '{task.title}'")
    if "due_date" in sent and payload.due_date != task.due_date:
        task.due_date = payload.due_date
        summaries.append(f"Set task '{task.title}' due {payload.due_date.isoformat() if payload.due_date else 'whenever'}")
    if "assignee_id" in sent and payload.assignee_id != task.assignee_id:
        assignee = active_user(db, payload.assignee_id)
        task.assignee_id = payload.assignee_id
        summaries.append(f"Assigned task '{task.title}' {_for(assignee)}")
    if "done" in sent and payload.done is not None and payload.done != (task.done_at is not None):
        task.done_at = datetime.now(timezone.utc) if payload.done else None
        task.done_by_id = user.id if payload.done else None
        summaries.append(f"{'Completed' if payload.done else 'Reopened'} task '{task.title}'")
    for summary in summaries:
        _audit(db, user, AuditAction.update, task, summary)
    db.commit()
    db.refresh(task)
    return to_out(db, [task])[0]


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_task(task_id: UUID, db: Session = Depends(get_db), user: User = Depends(require_role(Role.editor))) -> None:
    """Whoever made it, whoever it's assigned to, or an admin."""
    task = _get(db, task_id)
    if user.id not in (task.created_by_id, task.assignee_id) and not has_role(user, Role.admin):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only whoever made it, whoever it's for, or an admin can delete a task")
    _audit(db, user, AuditAction.delete, task, f"Deleted task '{task.title}'")
    db.delete(task)
    db.commit()


# --- Notes: a running log on a task -------------------------------------------------


def _note_out(db: Session, notes: list[TaskNote]) -> list[TaskNoteOut]:
    ids = {n.author_id for n in notes if n.author_id}
    names = dict(db.query(User.id, User.username).filter(User.id.in_(ids)).all()) if ids else {}
    return [
        TaskNoteOut(id=n.id, author_id=n.author_id, author_username=names.get(n.author_id), body=n.body, created_at=n.created_at)
        for n in notes
    ]


@router.get("/{task_id}/notes", response_model=list[TaskNoteOut])
def list_task_notes(task_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> list[TaskNoteOut]:
    """Newest first."""
    _get(db, task_id)
    notes = db.query(TaskNote).filter(TaskNote.task_id == task_id).order_by(TaskNote.created_at.desc()).all()
    return _note_out(db, notes)


@router.post(
    "/{task_id}/notes",
    response_model=TaskNoteOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def add_task_note(
    task_id: UUID, payload: TaskNoteCreate, db: Session = Depends(get_db), user: User = Depends(require_role(Role.viewer))
) -> TaskNoteOut:
    """Editors, or whoever the task is for."""
    task = _get(db, task_id)
    if not has_role(user, Role.editor) and task.assignee_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only editors, or whoever the task is for, can add notes")
    note = TaskNote(task_id=task.id, author_id=user.id, body=payload.body)
    db.add(note)
    db.flush()
    _audit(db, user, AuditAction.create, task, f"Added a note to task '{task.title}'")
    db.commit()
    db.refresh(note)
    return _note_out(db, [note])[0]


@router.delete("/{task_id}/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_task_note(
    task_id: UUID, note_id: UUID, db: Session = Depends(get_db), user: User = Depends(require_role(Role.viewer))
) -> None:
    """Whoever wrote it, or an admin."""
    task = _get(db, task_id)
    note = db.get(TaskNote, note_id)
    if note is None or note.task_id != task.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found")
    if note.author_id != user.id and not has_role(user, Role.admin):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only whoever wrote a note, or an admin, can delete it")
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.task.value,
        entity_id=task.id,
        summary=f"Deleted a note from task '{task.title}'",
        changes=snapshot(note, ["body"]),
        emitter_id=task.entity_id if task.entity_type == "emitter" else None,
    )
    db.delete(note)
    db.commit()

