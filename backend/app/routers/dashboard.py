"""The dashboard: everything at once (GET /dashboard), or one section at a
time so each card loads on its own."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_role
from app.models.mdf import Mdf
from app.models.user import User
from app.schemas.dashboard import (
    ActivityOut,
    AdminOut,
    AttentionOut,
    CurrentMdfIn,
    DashboardOut,
    HealthOut,
    OverviewOut,
    ReleaseOut,
    TestRunsOut,
)
from app.services import app_settings
from app.services import dashboard_service as svc
from app.services.audit_service import record_audit

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardOut)
def get_dashboard(db: Session = Depends(get_db), user: User = Depends(require_role(Role.viewer))) -> DashboardOut:
    return DashboardOut(**svc.compute_dashboard(db, user))


@router.get("/overview", response_model=OverviewOut)
def get_overview(db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> OverviewOut:
    """Status counts, and every Emitter's SIM Test Line results."""
    return OverviewOut(**svc.overview_section(db))


@router.get("/attention", response_model=AttentionOut)
def get_attention(db: Session = Depends(get_db), user: User = Depends(require_role(Role.viewer))) -> AttentionOut:
    return AttentionOut(**svc.attention_section(db, user))


@router.get("/test-runs", response_model=TestRunsOut)
def get_test_runs(db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> TestRunsOut:
    return TestRunsOut(**svc.test_runs_section(db))


@router.get("/activity", response_model=ActivityOut)
def get_activity(
    everything: bool = False, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> ActivityOut:
    """Latest changes; `everything` also includes sign-ins and edit starts/ends."""
    return ActivityOut(recent_activity=svc._compute_recent_activity(db, everything=everything))


@router.get("/admin", response_model=AdminOut)
def get_admin(db: Session = Depends(get_db), _=Depends(require_role(Role.admin))) -> AdminOut:
    return AdminOut(**svc.admin_section(db))


def _release(db: Session) -> dict:
    out = svc.release_section(db)
    out["changes"] = None
    if out["mdf"] is not None:
        # The summary's default span: since the last release, else since the
        # MDF this one follows, else from the start.
        from app.routers.mdf_plan import build_summary

        try:
            s = build_summary(db, db.get(Mdf, UUID(out["mdf"]["id"])), None, None)
        except HTTPException:
            s = None  # nothing saved yet
        if s is not None:
            since = (
                f"{s['from_mdf']['name']} v{s['from_mdf']['version']}"
                if s.get("from_mdf")
                else f"v{s['from_version']}" if s.get("from_version") else "the start"
            )
            out["changes"] = {"since": since, "to_version": s["to_version"], "change_notes": s["change_notes"]}
    return out


@router.get("/release", response_model=ReleaseOut)
def get_release(db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> dict:
    """The current MDF: the one an admin pinned, else the most recently
    changed MDF that isn't released — with every Emitter on it and what the
    customer will get (its change notes)."""
    return _release(db)


@router.put("/current-mdf", response_model=ReleaseOut, dependencies=[Depends(verify_csrf)])
def pin_current_mdf(payload: CurrentMdfIn, db: Session = Depends(get_db), user=Depends(require_role(Role.admin))) -> dict:
    """Pin the MDF the dashboard is about (None unpins it)."""
    old = app_settings.get_setting(db, app_settings.CURRENT_MDF)
    mdf = None
    if payload.mdf_id is not None:
        try:
            mdf = db.get(Mdf, UUID(payload.mdf_id))
        except ValueError:
            mdf = None
        if mdf is None or mdf.is_deleted:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "MDF not found")
    new = str(mdf.id) if mdf else None
    if new != old:
        app_settings.set_setting(db, app_settings.CURRENT_MDF, new, user.id)
        record_audit(
            db,
            actor_id=user.id,
            action=AuditAction.update,
            entity_type=AuditEntityType.setting.value,
            entity_id=None,
            summary=f"Pinned MDF '{mdf.name}' to the dashboard" if mdf else "Unpinned the dashboard's MDF",
            changes={app_settings.CURRENT_MDF: {"old": old, "new": new}},
        )
        db.commit()
    return _release(db)


@router.get("/health", response_model=HealthOut)
def get_health(db: Session = Depends(get_db), user: User = Depends(require_role(Role.viewer))) -> dict:
    """Counts of what needs a look across everything."""
    return svc.health_section(db, user)
