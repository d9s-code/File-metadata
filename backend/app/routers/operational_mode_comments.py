"""Comments on an Emitter's plan: a thread on each operational mode and on
the plan as a whole, replies, and open / resolved — for analysis, so any
editor can write them without holding the Emitter. Not versioned."""

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_role
from app.models.emitter import Emitter
from app.models.operational_mode import OperationalMode, OperationalModeComment
from app.schemas.operational_mode import (
    OperationalModeCommentCreate,
    OperationalModeCommentOut,
    OperationalModeCommentUpdate,
)
from app.services.audit_service import record_audit

router = APIRouter(prefix="/emitters/{emitter_id}/plan-comments", tags=["operational-modes"])


def _out(c: OperationalModeComment) -> OperationalModeCommentOut:
    out = OperationalModeCommentOut.model_validate(c)
    out.author_username = c.author.username if c.author else None
    out.resolved_by_username = c.resolved_by.username if c.resolved_by else None
    return out


def _emitter_or_404(db: Session, emitter_id: UUID) -> Emitter:
    emitter = db.get(Emitter, emitter_id)
    if emitter is None or emitter.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    return emitter


def _comment_or_404(db: Session, emitter_id: UUID, comment_id: UUID) -> OperationalModeComment:
    c = db.get(OperationalModeComment, comment_id)
    if c is None or c.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Comment not found")
    return c


def _about(c: OperationalModeComment) -> str:
    return f"operational mode '{c.operational_mode_name}'" if c.operational_mode_name else "the plan"


@router.get("", response_model=list[OperationalModeCommentOut])
def list_comments(emitter_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))):
    """Every comment on the Emitter's plan, oldest first."""
    _emitter_or_404(db, emitter_id)
    rows = (
        db.query(OperationalModeComment)
        .options(joinedload(OperationalModeComment.author), joinedload(OperationalModeComment.resolved_by))
        .filter(OperationalModeComment.emitter_id == emitter_id)
        .order_by(OperationalModeComment.created_at, OperationalModeComment.id)
        .all()
    )
    return [_out(c) for c in rows]


@router.post("", response_model=OperationalModeCommentOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
def add_comment(
    emitter_id: UUID,
    payload: OperationalModeCommentCreate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
):
    _emitter_or_404(db, emitter_id)
    op_id, op_name = payload.operational_mode_id, None
    if payload.parent_id is not None:
        parent = _comment_or_404(db, emitter_id, payload.parent_id)
        if parent.parent_id is not None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Reply to the comment that started the thread")
        op_id, op_name = parent.operational_mode_id, parent.operational_mode_name
    elif op_id is not None:
        op = db.get(OperationalMode, op_id)
        if op is None or op.emitter_id != emitter_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "That operational mode isn't one of this Emitter's")
        op_name = op.name
    c = OperationalModeComment(
        emitter_id=emitter_id,
        operational_mode_id=op_id,
        operational_mode_name=op_name,
        parent_id=payload.parent_id,
        author_id=user.id,
        body=payload.body.strip(),
    )
    if not c.body:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A comment needs some text")
    db.add(c)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.operational_mode_comment.value,
        entity_id=c.id,
        summary=f"{'Replied to a comment' if c.parent_id else 'Commented'} on {_about(c)}",
        changes={"body": {"old": None, "new": c.body}},
        emitter_id=emitter_id,
    )
    db.commit()
    db.refresh(c)
    return _out(c)


@router.patch("/{comment_id}", response_model=OperationalModeCommentOut, dependencies=[Depends(verify_csrf)])
def update_comment(
    emitter_id: UUID,
    comment_id: UUID,
    payload: OperationalModeCommentUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
):
    c = _comment_or_404(db, emitter_id, comment_id)
    changes: dict = {}
    if payload.body is not None:
        if c.author_id != user.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only its author can change a comment's text")
        body = payload.body.strip()
        if not body:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A comment needs some text")
        if body != c.body:
            changes["body"] = {"old": c.body, "new": body}
            c.body = body
            c.edited_at = datetime.now(UTC)
    if payload.resolved is not None and payload.resolved != c.resolved:
        if c.parent_id is not None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A thread is resolved on its first comment")
        changes["resolved"] = {"old": c.resolved, "new": payload.resolved}
        c.resolved = payload.resolved
        c.resolved_by_id = user.id if payload.resolved else None
        c.resolved_at = datetime.now(UTC) if payload.resolved else None
    if changes:
        what = "Resolved" if changes.get("resolved", {}).get("new") is True else "Reopened" if "resolved" in changes else "Edited"
        record_audit(
            db,
            actor_id=user.id,
            action=AuditAction.update,
            entity_type=AuditEntityType.operational_mode_comment.value,
            entity_id=c.id,
            summary=f"{what} a comment on {_about(c)}",
            changes=changes,
            emitter_id=emitter_id,
        )
    db.commit()
    db.refresh(c)
    return _out(c)


@router.delete("/{comment_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_comment(
    emitter_id: UUID,
    comment_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> None:
    """Its author's, or an admin's, to delete — with its replies."""
    c = _comment_or_404(db, emitter_id, comment_id)
    if c.author_id != user.id and user.role != Role.admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only its author or an admin can delete a comment")
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.operational_mode_comment.value,
        entity_id=c.id,
        summary=f"Deleted a comment on {_about(c)}",
        changes={"body": {"old": c.body, "new": None}},
        emitter_id=emitter_id,
    )
    db.delete(c)
    db.commit()
