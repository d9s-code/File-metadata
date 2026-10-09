import json
from datetime import datetime, timezone
from uuid import UUID

from app.core.enums import AmbiguityRunStatus, AmbiguityScopeType
from app.database import SessionLocal
from app.models.ambiguity import AmbiguityFinding, AmbiguityRun
from app.models.emitter_version import EmitterVersion
from app.models.mdf import MdfVersion
from app.models.platform import PlatformVersion
from app.services.ambiguity_service import (
    carry_forward_reviews,
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
    return _distinct_lines(flatten_mdf_snapshot(version.snapshot))


def _distinct_lines(lines: list) -> list:
    """An Emitter pinned on several of an MDF's Platforms counts once per
    distinct Mode line, not once per Platform."""
    seen: set[tuple] = set()
    out = []
    for line in lines:
        key = (line.emitter_id, line.mode_id, json.dumps(line.line, sort_keys=True, default=str))
        if key not in seen:
            seen.add(key)
            out.append(line)
    return out


def _prior_reviewed_findings(db, run: AmbiguityRun) -> list[dict]:
    """The most recent prior *complete* run's reviewed findings for the same
    scope — "the run immediately before this one." No schema change needed:
    AmbiguityRun is already fully self-describing by scope_type/scope_id.
    """
    prior_run = (
        db.query(AmbiguityRun)
        .filter(
            AmbiguityRun.scope_type == run.scope_type,
            AmbiguityRun.scope_id == run.scope_id,
            AmbiguityRun.status == AmbiguityRunStatus.complete,
            AmbiguityRun.id != run.id,
        )
        .order_by(AmbiguityRun.created_at.desc())
        .first()
    )
    if prior_run is None:
        return []
    prior_findings = (
        db.query(AmbiguityFinding)
        .filter(AmbiguityFinding.run_id == prior_run.id, AmbiguityFinding.reviewed_by.isnot(None))
        .all()
    )
    return [
        {
            "mode_id_a": str(pf.mode_id_a),
            "mode_id_b": str(pf.mode_id_b),
            "rf_overlap_pct": float(pf.rf_overlap_pct),
            "pw_overlap_pct": float(pf.pw_overlap_pct),
            "pri_overlap_pct": float(pf.pri_overlap_pct) if pf.pri_overlap_pct is not None else None,
            "jitter_overlap_pct": (pf.details or {}).get("jitter_overlap_pct"),
            "combined_severity": pf.combined_severity.value,
            "reviewed_by": pf.reviewed_by,
            "reviewed_at": pf.reviewed_at,
            "reviewer_note": pf.reviewer_note,
        }
        for pf in prior_findings
    ]


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
            # A Platform or MDF check asks which Emitters can be taken for each
            # other, so it leaves out overlaps inside a single Emitter.
            findings = compute_pairwise_findings(
                mode_lines,
                run.tolerance_config,
                across_emitters_only=run.scope_type != AmbiguityScopeType.emitter,
            )
            prior_reviewed = _prior_reviewed_findings(db, run)
            if prior_reviewed:
                carry_forward_reviews(findings, prior_reviewed)
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
