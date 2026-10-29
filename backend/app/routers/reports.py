from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import Role
from app.database import get_db
from app.deps import require_role
from app.services.analysis_report_service import build_analysis
from app.services.emitter_report_service import ReportError, build_report

router = APIRouter(prefix="/reports", tags=["reports"])

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class EmitterReportRequest(BaseModel):
    platform_ids: list[UUID] = []
    emitter_ids: list[UUID] = []


@router.post("/emitters", dependencies=[Depends(verify_csrf)])
def emitter_report(
    payload: EmitterReportRequest,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> Response:
    """The Emitter report for the Platforms and Emitters picked, as a spreadsheet:
    a line per Mode — see emitter_report_service for what's in it and its order."""
    try:
        content = build_report(db, payload.platform_ids, payload.emitter_ids)
    except ReportError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc))
    filename = f"Emitter report {date.today().isoformat()}.xlsx"
    return Response(content=content, media_type=XLSX, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.post("/analysis", dependencies=[Depends(verify_csrf)])
def analysis_report(
    payload: EmitterReportRequest,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> Response:
    """The analysis sheet for the Platforms and Emitters picked: Modes with
    their Sources and notes and every value as typed and with its delta,
    Sources, Elements and notes — see analysis_report_service."""
    try:
        content = build_analysis(db, payload.platform_ids, payload.emitter_ids)
    except ReportError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc))
    filename = f"Analysis sheet {date.today().isoformat()}.xlsx"
    return Response(content=content, media_type=XLSX, headers={"Content-Disposition": f'attachment; filename="{filename}"'})
