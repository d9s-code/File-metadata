from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AmbiguityRunStatus, AmbiguityScopeType, AmbiguitySeverity, Role
from app.database import get_db
from app.deps import require_role
from app.models.ambiguity import AmbiguityFinding, AmbiguityRun
from app.models.emitter import Emitter
from app.models.emitter_version import EmitterVersion
from app.models.mdf import Mdf, MdfVersion
from app.models.platform import Platform, PlatformVersion
from app.schemas.ambiguity import AmbiguityFindingOut, AmbiguityRunCreate, AmbiguityRunOut, FindingReviewRequest
from app.services.ambiguity_run_service import execute_ambiguity_run
from app.services.ambiguity_service import DEFAULT_TOLERANCE

router = APIRouter(prefix="/ambiguity", tags=["ambiguity"])

_SCOPE_MODELS = {
    AmbiguityScopeType.emitter: (Emitter, EmitterVersion, "emitter_id", "emitter_version_id"),
    AmbiguityScopeType.platform: (Platform, PlatformVersion, "platform_id", "platform_version_id"),
    AmbiguityScopeType.mdf: (Mdf, MdfVersion, "mdf_id", "mdf_version_id"),
}


def _resolve_version(db: Session, payload: AmbiguityRunCreate):
    entity_model, version_model, fk_field, _ = _SCOPE_MODELS[payload.scope_type]
    entity = db.get(entity_model, payload.scope_id)
    if entity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{payload.scope_type.value.title()} not found")

    query = db.query(version_model).filter(getattr(version_model, fk_field) == payload.scope_id)
    if payload.version_number is not None:
        version = query.filter(version_model.version_number == payload.version_number).first()
    else:
        version = query.order_by(version_model.version_number.desc()).first()

    if version is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"No committed version found for this {payload.scope_type.value} — commit one first",
        )
    return version


@router.post("/runs", response_model=AmbiguityRunOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
def create_ambiguity_run(
    payload: AmbiguityRunCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.viewer)),
) -> AmbiguityRun:
    version = _resolve_version(db, payload)
    _, _, _, version_fk_field = _SCOPE_MODELS[payload.scope_type]

    run = AmbiguityRun(
        scope_type=payload.scope_type,
        scope_id=payload.scope_id,
        tolerance_config=payload.tolerance_config or DEFAULT_TOLERANCE,
        created_by=user.id,
        **{version_fk_field: version.id},
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    background_tasks.add_task(execute_ambiguity_run, run.id)
    return run


@router.get("/runs/{run_id}", response_model=AmbiguityRunOut)
def get_ambiguity_run(run_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> AmbiguityRun:
    run = db.get(AmbiguityRun, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    return run


@router.get("/runs", response_model=list[AmbiguityRunOut])
def list_ambiguity_runs(
    scope_type: AmbiguityScopeType | None = None,
    scope_id: UUID | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> list[AmbiguityRun]:
    q = db.query(AmbiguityRun)
    if scope_type is not None:
        q = q.filter(AmbiguityRun.scope_type == scope_type)
    if scope_id is not None:
        q = q.filter(AmbiguityRun.scope_id == scope_id)
    return q.order_by(AmbiguityRun.created_at.desc()).all()


@router.get("/runs/{run_id}/findings", response_model=list[AmbiguityFindingOut])
def list_findings(
    run_id: UUID,
    severity: AmbiguitySeverity | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> list[AmbiguityFinding]:
    if db.get(AmbiguityRun, run_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    q = db.query(AmbiguityFinding).filter(AmbiguityFinding.run_id == run_id)
    if severity is not None:
        q = q.filter(AmbiguityFinding.combined_severity == severity)
    return q.all()


@router.post("/findings/{finding_id}/review", response_model=AmbiguityFindingOut, dependencies=[Depends(verify_csrf)])
def review_finding(
    finding_id: UUID,
    payload: FindingReviewRequest,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> AmbiguityFinding:
    finding = db.get(AmbiguityFinding, finding_id)
    if finding is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Finding not found")
    finding.reviewed_by = user.id
    finding.reviewed_at = datetime.now(timezone.utc)
    finding.reviewer_note = payload.reviewer_note
    db.commit()
    db.refresh(finding)
    return finding


@router.post(
    "/findings/{finding_id}/unreview", response_model=AmbiguityFindingOut, dependencies=[Depends(verify_csrf)]
)
def unreview_finding(
    finding_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.editor))
) -> AmbiguityFinding:
    finding = db.get(AmbiguityFinding, finding_id)
    if finding is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Finding not found")
    finding.reviewed_by = None
    finding.reviewed_at = None
    finding.reviewer_note = None
    db.commit()
    db.refresh(finding)
    return finding
