from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings as app_config
from app.core.csrf import verify_csrf
from app.core.enums import Role
from app.database import get_db
from app.deps import require_role
from app.services.analysis_report_service import build_analysis
from app.core.downloads import attachment_disposition
from app.models.mdf import Mdf
from app.services.emitter_report_service import ReportError, build_mdf_report, build_report
from app.services.report_compare import WorkbookError, compare_workbooks, read_workbook

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
    """The Emitter report for the Platforms and Emitters picked, laid out like
    the other app's import report — see emitter_report_service."""
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


@router.get("/mdfs/{mdf_id}")
def mdf_report(
    mdf_id: UUID,
    version: int | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> Response:
    """The Emitter report for a saved MDF version (the latest unless
    `version` is given), laid out like the other app's import report — see
    emitter_report_service.build_mdf_report."""
    mdf = db.get(Mdf, mdf_id)
    if mdf is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MDF not found")
    try:
        content, number = build_mdf_report(db, mdf_id, version)
    except ReportError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc))
    filename = f"MDF report {mdf.name} v{number} {date.today().isoformat()}.xlsx"
    return Response(content=content, media_type=XLSX, headers={"Content-Disposition": attachment_disposition(filename)})


# Differences sent back at most — past that the report is surely the wrong one.
MAX_DIFFERENCES = 2000


@router.post("/mdfs/{mdf_id}/compare", dependencies=[Depends(verify_csrf)])
def compare_mdf_report(
    mdf_id: UUID,
    file: UploadFile = File(...),
    version: int | None = Form(None),
    include_unknown: bool = Form(False),
    strict_text: bool = Form(False),
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> dict:
    """The import check: the report the other app made after importing this
    MDF, compared with this app's report of a saved version (the latest
    unless `version` is given) — rows matched by name, whatever their order;
    see report_compare. Nothing is stored."""
    mdf = db.get(Mdf, mdf_id)
    if mdf is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MDF not found")
    content = file.file.read(app_config.max_upload_bytes + 1)
    if len(content) > app_config.max_upload_bytes:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "The file is larger than the upload limit")
    try:
        ours, number = build_mdf_report(db, mdf_id, version)
    except ReportError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc))
    try:
        theirs = read_workbook(content, max_bytes=app_config.max_upload_bytes * 20)
    except WorkbookError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"{exc} — upload the .xlsx the other app made") from exc
    result = compare_workbooks(read_workbook(ours), theirs, include_unknown=include_unknown, strict_text=strict_text)
    differences = result["differences"]
    return {
        "mdf_version": number,
        "file_name": file.filename,
        "agrees": not differences,
        "rows": result["rows"],
        "difference_count": len(differences),
        "differences": differences[:MAX_DIFFERENCES],
    }
