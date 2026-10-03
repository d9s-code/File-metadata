"""Admin → Backups: what backups there are, whether they're in order, taking one
now, checking one restores, and comparing what two of them (or one and the live
data) hold — see app/services/backup_service.py. Restoring stays a deliberate
command-line step (scripts/restore_db.py), never a button."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_role
from app.services import backup_service
from app.services.audit_service import record_audit
from app.services.backup_service import BackupError

router = APIRouter(prefix="/admin/backups", tags=["backups"], dependencies=[Depends(require_role(Role.admin))])
# For everyone signed in: the dashboard's Backup card.
status_router = APIRouter(prefix="/backup-status", tags=["backups"], dependencies=[Depends(require_role(Role.viewer))])


@status_router.get("")
def backup_status() -> dict:
    """Time since the latest backup, what's changed since, and whether one is due."""
    return backup_service.backup_freshness()

LIVE = "live"


def _item(path_name: str, manifest: dict | None, when_iso: str, size: int) -> dict:
    m = manifest or {}
    return {
        "file": path_name,
        "created_at": m.get("created_at") or when_iso,
        "kind": m.get("kind", "unknown"),
        "created_by": m.get("created_by"),
        "size_bytes": m.get("size_bytes") or size,
        "summary": backup_service.counts_summary(m.get("overview")),
        "has_overview": m.get("overview") is not None,
        "verification": m.get("verification"),
        "copied_to": m.get("copied_to"),
        "sha256": m.get("sha256"),
    }


def _items() -> list[dict]:
    return [
        _item(b.path.name, b.manifest, b.when.isoformat(), b.path.stat().st_size) for b in backup_service.list_backups()
    ]


def _fail(err: BackupError):
    raise HTTPException(status.HTTP_409_CONFLICT, str(err)) from err


@router.get("")
def list_backups() -> dict:
    return {"health": backup_service.backup_health(), "backups": _items(), "live": backup_service.counts_summary(backup_service.live_overview())}


@router.get("/health")
def backup_health() -> dict:
    return backup_service.backup_health()


@router.post("", status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
def back_up_now(user=Depends(require_role(Role.admin)), db: Session = Depends(get_db)) -> dict:
    try:
        manifest = backup_service.take_backup(kind="manual", created_by=user.username)
    except BackupError as err:
        _fail(err)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.backup.value,
        entity_id=None,
        summary=f"Took backup {manifest['file']}",
    )
    db.commit()
    return next(i for i in _items() if i["file"] == manifest["file"])


@router.get("/{name}/download")
def download(name: str, user=Depends(require_role(Role.admin)), db: Session = Depends(get_db)) -> FileResponse:
    """The backup file itself, to keep a copy on another computer. It holds the whole
    database — user accounts' password hashes included — so each download is audited."""
    try:
        dump = backup_service.resolve_dump(name)
    except BackupError as err:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(err)) from err
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.download,
        entity_type=AuditEntityType.backup.value,
        entity_id=None,
        summary=f"Downloaded backup {name}",
    )
    db.commit()
    return FileResponse(dump, media_type="application/octet-stream", filename=name)


@router.post("/{name}/verify", dependencies=[Depends(verify_csrf)])
def verify(name: str) -> dict:
    try:
        backup_service.verify_backup(name)
    except BackupError as err:
        _fail(err)
    return next(i for i in _items() if i["file"] == name)


def _overview(name: str) -> tuple[dict, str]:
    if name == LIVE:
        return backup_service.live_overview(), "Current data"
    try:
        dump = backup_service.resolve_dump(name)
    except BackupError as err:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(err)) from err
    manifest = backup_service.read_manifest(dump) or {}
    if manifest.get("overview") is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"{name} was made before backups kept an overview — verify it once to fill one in",
        )
    return manifest["overview"], manifest.get("created_at") or name


@router.get("/diff")
def diff(
    from_: str = Query(alias="from", description="A backup's file name"),
    to: str = Query(LIVE, description="Another backup's file name, or 'live' for the current data"),
) -> dict:
    old, old_label = _overview(from_)
    new, new_label = _overview(to)
    return {"from": {"name": from_, "label": old_label}, "to": {"name": to, "label": new_label}, "changes": backup_service.diff_overviews(old, new)}
