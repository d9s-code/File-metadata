from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.enums import Role
from app.database import get_db
from app.deps import require_role
from app.schemas.dashboard import DashboardOut
from app.services.dashboard_service import compute_dashboard

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardOut)
def get_dashboard(db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> DashboardOut:
    return DashboardOut(**compute_dashboard(db))
