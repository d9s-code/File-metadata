"""The server's side of the standalone (offline) app: a copy to take away, and
syncing what was changed on the PC back in (see app/services/sync_service.py)."""

import gzip
import json

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_role
from app.services import sync_service
from app.services.audit_service import record_audit
from app.services.sync_service import SyncError

router = APIRouter(prefix="/sync", tags=["sync"])
_DONE = {"insert": "added", "update": "updated", "delete": "deleted"}


class SyncRequest(BaseModel):
    payload: dict
    # Per group of conflicts (its key): "server" or "pc" — which side wins.
    resolutions: dict[str, str] = Field(default_factory=dict)
    # Which PC it came from, for the Audit Log.
    device: str | None = Field(default=None, max_length=200)


@router.get("/info")
def sync_info(db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> dict:
    """The database version a PC's app must match to sync with this server."""
    return {"schema": sync_service.schema_version(db.connection())}


@router.get("/copy")
def take_copy(db: Session = Depends(get_db), user=Depends(require_role(Role.admin))) -> Response:
    """The whole database, as gzipped JSON, for the standalone app to work on
    offline — Admins only, like syncing (passwords aren't in it)."""
    # One consistent snapshot of every table, on a connection of its own.
    with db.get_bind().connect().execution_options(isolation_level="REPEATABLE READ") as conn:
        copy = sync_service.export_copy(conn)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.sync.value,
        entity_id=None,
        summary=f"{user.username} took a copy of the database to work on offline",
        changes={"rows": sum(len(r) for r in copy["tables"].values())},
    )
    db.commit()
    body = gzip.compress(json.dumps(copy, separators=(",", ":")).encode(), compresslevel=6)
    return Response(content=body, media_type="application/json", headers={"Content-Encoding": "gzip"})


def _plan(db: Session, req: SyncRequest, user) -> sync_service.Plan:
    try:
        return sync_service.plan_sync(db.connection(), req.payload, user_id=user.id, resolutions=req.resolutions)
    except SyncError as err:
        raise HTTPException(status.HTTP_409_CONFLICT, str(err)) from err
    except (KeyError, TypeError, ValueError) as err:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"The changes from the PC can't be read: {err}") from err


@router.post("/preview", dependencies=[Depends(verify_csrf)])
def preview_sync(req: SyncRequest, db: Session = Depends(get_db), user=Depends(require_role(Role.admin))) -> dict:
    """What syncing would do, and the conflicts to settle — nothing is changed."""
    plan = _plan(db, req, user)
    db.rollback()
    return sync_service.plan_to_json(plan)


@router.post("/apply", dependencies=[Depends(verify_csrf)])
def apply_sync(req: SyncRequest, db: Session = Depends(get_db), user=Depends(require_role(Role.admin))) -> dict:
    """Writes the PC's changes in, all or nothing. Refused (409, with the new
    preview) if a conflict hasn't been settled — including one that appeared
    on the server since the preview."""
    plan = _plan(db, req, user)
    if plan.unresolved:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"message": "Some conflicts need settling first", "preview": sync_service.plan_to_json(plan)},
        )
    try:
        counts = sync_service.apply_sync(db.connection(), plan)
        conflicts = sum(len(g.conflicts) for g in plan.groups.values())
        record_audit(
            db,
            actor_id=user.id,
            action=AuditAction.update,
            entity_type=AuditEntityType.sync.value,
            entity_id=None,
            summary=(
                f"Synced changes made offline{f' on {req.device}' if req.device else ''}: "
                + ", ".join(f"{n} {_DONE[a]}" for a, n in counts.items())
                + (f"; {conflicts} conflict(s) settled" if conflicts else "")
            ),
            changes={
                "counts": counts,
                "notes": plan.notes,
                "resolutions": req.resolutions,
            },
        )
        db.commit()
    except IntegrityError as err:
        db.rollback()
        detail = str(err.orig).strip().splitlines()[0] if err.orig else str(err)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"The server refused the changes, and nothing was changed: {detail}",
        ) from err
    return {"applied": counts, "notes": plan.notes}
