"""The dashboard: everything at once (GET /dashboard), or one section at a
time so each card loads on its own."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.enums import Role
from app.database import get_db
from app.deps import require_role
from app.models.user import User
from app.schemas.dashboard import ActivityOut, AdminOut, AttentionOut, DashboardOut, OverviewOut, TestRunsOut
from app.services import dashboard_service as svc

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
