from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AmbiguityRunStatus, AmbiguityScopeType, AmbiguitySeverity, AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import has_role, require_role
from app.models.ambiguity import AmbiguityFinding, AmbiguityRun
from app.models.emitter import Emitter
from app.models.emitter_version import EmitterVersion
from app.models.mdf import Mdf, MdfVersion
from app.models.mode import Mode
from app.models.platform import Platform, PlatformVersion
from app.schemas.ambiguity import (
    AmbiguityFindingOut,
    AmbiguityRunCreate,
    AmbiguityRunOut,
    FindingReviewRequest,
    MergeRequest,
)
from app.services import checkout_service, mode_merge_service
from app.services import knowledge_service, llm_client, outline_client
from app.services.ai_review_service import explain_finding, summarise_run
from app.services.ambiguity_run_service import execute_ambiguity_run
from app.services.ambiguity_service import DEFAULT_TOLERANCE
from app.services.audit_service import apply_and_diff, record_audit

router = APIRouter(prefix="/ambiguity", tags=["ambiguity"])
ai_router = APIRouter(prefix="/ai", tags=["ai"])

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
            status.HTTP_422_UNPROCESSABLE_CONTENT,
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
    if payload.tolerance_config is not None and not has_role(user, Role.editor):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only Editors and Admins may set a custom tolerance")

    version = _resolve_version(db, payload)
    _, _, _, version_fk_field = _SCOPE_MODELS[payload.scope_type]

    run = AmbiguityRun(
        scope_type=payload.scope_type,
        scope_id=payload.scope_id,
        tolerance_config={**DEFAULT_TOLERANCE, **(payload.tolerance_config or {})},
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


def _finding_emitter_id(finding: AmbiguityFinding) -> UUID | None:
    # scope_id is polymorphic (emitter/platform/mdf) — only pass it on as the
    # audit row's emitter_id (a real FK to emitters.id) when the run it
    # belongs to is actually Emitter-scoped, so a Platform/MDF-scoped
    # finding's review never gets misattributed to an unrelated Emitter.
    return finding.run.scope_id if finding.run.scope_type == AmbiguityScopeType.emitter else None


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
    changes = apply_and_diff(
        finding,
        {"reviewed_by": user.id, "reviewed_at": datetime.now(timezone.utc), "reviewer_note": payload.reviewer_note},
    )
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.ambiguity_finding.value,
        entity_id=finding.id,
        summary=f"Reviewed an ambiguity finding ({finding.combined_severity.value} severity)",
        changes=changes,
        emitter_id=_finding_emitter_id(finding),
    )
    db.commit()
    db.refresh(finding)
    return finding


@router.post(
    "/findings/{finding_id}/unreview", response_model=AmbiguityFindingOut, dependencies=[Depends(verify_csrf)]
)
def unreview_finding(
    finding_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> AmbiguityFinding:
    finding = db.get(AmbiguityFinding, finding_id)
    if finding is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Finding not found")
    changes = apply_and_diff(finding, {"reviewed_by": None, "reviewed_at": None, "reviewer_note": None})
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.ambiguity_finding.value,
        entity_id=finding.id,
        summary=f"Un-reviewed an ambiguity finding ({finding.combined_severity.value} severity)",
        changes=changes,
        emitter_id=_finding_emitter_id(finding),
    )
    db.commit()
    db.refresh(finding)
    return finding


@ai_router.get("/status")
def ai_status(db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> dict:
    """Whether a language model is set up — the AI buttons show only if so —
    and the documentation it's given as background, if any."""
    return {
        "enabled": llm_client.enabled(),
        "model": llm_client.settings.llm_model if llm_client.enabled() else None,
        "documentation": knowledge_service.status(db) if knowledge_service.enabled() else None,
    }


@ai_router.post("/documentation/sync", dependencies=[Depends(verify_csrf)])
def sync_documentation(_=Depends(require_role(Role.admin))) -> dict:
    """Copy the documentation from Outline now, rather than when it's next
    over OUTLINE_SYNC_MINUTES old."""
    if not knowledge_service.enabled():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "No documentation is set up — set OUTLINE_URL, OUTLINE_API_TOKEN and OUTLINE_ROOT or OUTLINE_COLLECTION",
        )
    try:
        return knowledge_service.sync()
    except outline_client.OutlineError as err:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(err)) from err


def _ask(work):
    """Run a language-model request, turning its failures into clear HTTP errors."""
    try:
        return work()
    except llm_client.LlmNotConfigured as err:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(err)) from err
    except llm_client.LlmError as err:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(err)) from err


@router.post("/findings/{finding_id}/explain", response_model=AmbiguityFindingOut, dependencies=[Depends(verify_csrf)])
def explain_ambiguity_finding(
    finding_id: UUID,
    refresh: bool = False,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.viewer)),
) -> AmbiguityFinding:
    """A language model's explanation of one finding, and a recommendation —
    a draft, kept with the finding. Asked again only with refresh."""
    finding = db.get(AmbiguityFinding, finding_id)
    if finding is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Finding not found")
    if finding.ai_explanation is None or refresh:
        _ask(lambda: explain_finding(db, finding, user))
        db.commit()
        db.refresh(finding)
    return finding


@router.post("/runs/{run_id}/summary", response_model=AmbiguityRunOut, dependencies=[Depends(verify_csrf)])
def summarise_ambiguity_run(
    run_id: UUID,
    refresh: bool = False,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.viewer)),
) -> AmbiguityRun:
    """A language model's overview of a run's findings — a draft, kept with
    the run. Asked again only with refresh."""
    run = db.get(AmbiguityRun, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    if run.status != AmbiguityRunStatus.complete:
        raise HTTPException(status.HTTP_409_CONFLICT, "The check hasn't finished yet")
    if run.ai_summary is None or refresh:
        _ask(lambda: summarise_run(db, run, user))
        db.commit()
        db.refresh(run)
    return run


def _merge_finding(db: Session, finding_id: UUID) -> AmbiguityFinding:
    finding = db.get(AmbiguityFinding, finding_id)
    if finding is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Finding not found")
    if finding.resolution is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This finding's Modes have already been merged")
    return finding


@router.post("/findings/{finding_id}/merge-preview", dependencies=[Depends(verify_csrf)])
def preview_merge(
    finding_id: UUID, payload: MergeRequest, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> dict:
    """What merging this finding's two Modes would do — nothing is changed."""
    finding = _merge_finding(db, finding_id)
    try:
        return mode_merge_service.plan(db, finding, payload.keep)
    except mode_merge_service.MergeProblem as err:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(err)) from err


@router.post("/findings/{finding_id}/merge", response_model=AmbiguityFindingOut, dependencies=[Depends(verify_csrf)])
def merge_finding_modes(
    finding_id: UUID, payload: MergeRequest, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> AmbiguityFinding:
    """Keep one of the finding's two Modes, widened to cover both, and delete
    the other — in the Emitter's draft, so it must be checked out by you."""
    finding = _merge_finding(db, finding_id)
    kept_id = finding.mode_id_a if payload.keep == "a" else finding.mode_id_b
    kept = db.get(Mode, kept_id)
    if kept is not None:
        emitter = db.get(Emitter, kept.source.emitter_id)
        try:
            checkout_service.assert_checked_out_by(emitter, user.id)
        except checkout_service.NotCheckedOutByUser:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f'Start editing "{emitter.name}" first — a merge changes its Modes'
                if emitter.checked_out_by_id is None
                else f'"{emitter.name}" is being edited by someone else',
            )
    try:
        mode_merge_service.apply(db, finding, payload.keep, user)
    except mode_merge_service.MergeProblem as err:
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(err)) from err
    db.commit()
    db.refresh(finding)
    return finding
