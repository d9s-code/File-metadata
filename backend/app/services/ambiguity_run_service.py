from datetime import datetime, timezone
from uuid import UUID

from app.core.enums import AmbiguityRunStatus, AmbiguityScopeType
from app.database import SessionLocal
from app.models.ambiguity import AmbiguityFinding, AmbiguityRun
from app.models.emitter_version import EmitterVersion
from app.models.mdf import MdfVersion
from app.models.platform import PlatformVersion
from app.services.ambiguity_service import (
    compute_pairwise_findings,
    flatten_emitter_snapshot,
    flatten_mdf_snapshot,
    flatten_platform_snapshot,
)


def _load_mode_lines(db, run: AmbiguityRun) -> list:
    if run.scope_type == AmbiguityScopeType.emitter:
        version = db.get(EmitterVersion, run.emitter_version_id)
        return flatten_emitter_snapshot(version.snapshot)
    if run.scope_type == AmbiguityScopeType.platform:
        version = db.get(PlatformVersion, run.platform_version_id)
        return flatten_platform_snapshot(version.snapshot)
    version = db.get(MdfVersion, run.mdf_version_id)
    return flatten_mdf_snapshot(version.snapshot)


def execute_ambiguity_run(run_id: UUID) -> None:
    """Runs in a FastAPI BackgroundTask with its own DB session (the
    request-scoped session is already closed by the time this executes).
    """
    db = SessionLocal()
    try:
        run = db.get(AmbiguityRun, run_id)
        if run is None:
            return
        try:
            mode_lines = _load_mode_lines(db, run)
            findings = compute_pairwise_findings(mode_lines, run.tolerance_config)
            for f in findings:
                db.add(AmbiguityFinding(run_id=run.id, **f))
            run.status = AmbiguityRunStatus.complete
        except Exception as exc:  # noqa: BLE001 - persisted for operator visibility, not re-raised
            run.status = AmbiguityRunStatus.failed
            run.error_message = str(exc)
        run.completed_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()
