from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.core.enums import AmbiguityRunStatus, AmbiguityScopeType, AmbiguitySeverity


class AmbiguityRunCreate(BaseModel):
    scope_type: AmbiguityScopeType
    scope_id: UUID
    # Which committed version to analyze; defaults to the latest committed version of scope_id.
    version_number: int | None = None
    tolerance_config: dict | None = None


class AmbiguityRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    scope_type: AmbiguityScopeType
    scope_id: UUID
    emitter_version_id: UUID | None = None
    platform_version_id: UUID | None = None
    mdf_version_id: UUID | None = None
    status: AmbiguityRunStatus
    tolerance_config: dict
    error_message: str | None = None
    created_by: UUID | None = None
    created_at: datetime
    completed_at: datetime | None = None


class AmbiguityFindingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    run_id: UUID
    mode_id_a: UUID
    mode_id_b: UUID
    rf_overlap_pct: float
    pw_overlap_pct: float
    pri_overlap_pct: float | None = None
    pri_comparison_type: str
    combined_severity: AmbiguitySeverity
    details: dict
    reviewed_by: UUID | None = None
    reviewed_at: datetime | None = None
    reviewer_note: str | None = None


class FindingReviewRequest(BaseModel):
    reviewer_note: str | None = None
