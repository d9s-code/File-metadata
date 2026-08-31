from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.enums import AuditAction, Role
from app.database import get_db
from app.deps import require_role
from app.schemas.dashboard import ActivityTrendPoint, DashboardOut
from app.services.dashboard_service import compute_activity_trend, compute_dashboard

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardOut)
def get_dashboard(db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> DashboardOut:
    return DashboardOut(**compute_dashboard(db))


@router.get("/activity-trend", response_model=list[ActivityTrendPoint])
def get_activity_trend(
    action: AuditAction | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> list[ActivityTrendPoint]:
    """Same day-by-day window `GET /dashboard` returns by default, optionally
    narrowed to one audit action — kept separate so changing the Activity
    Trend chart's filter doesn't require re-fetching the whole dashboard.
    """
    return compute_activity_trend(db, action=action)
