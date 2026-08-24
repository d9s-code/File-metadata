import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import AmbiguityRunStatus, AmbiguityScopeType, AmbiguitySeverity
from app.database import Base
from app.models.mixins import UUIDPkMixin


class AmbiguityRun(UUIDPkMixin, Base):
    """One ambiguity-check execution against a specific, immutable version
    snapshot (never the live draft) — scope_id is polymorphic (an emitter,
    platform, or mdf id per scope_type); *_version_id records exactly which
    committed version was analyzed.
    """

    __tablename__ = "ambiguity_runs"

    scope_type: Mapped[AmbiguityScopeType] = mapped_column(nullable=False, index=True)
    scope_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    emitter_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("emitter_versions.id"), nullable=True
    )
    platform_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform_versions.id"), nullable=True
    )
    mdf_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("mdf_versions.id"), nullable=True
    )
    status: Mapped[AmbiguityRunStatus] = mapped_column(nullable=False, default=AmbiguityRunStatus.pending)
    tolerance_config: Mapped[dict] = mapped_column(JSONB, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    findings: Mapped[list["AmbiguityFinding"]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )


class AmbiguityFinding(UUIDPkMixin, Base):
    __tablename__ = "ambiguity_findings"

    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ambiguity_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # References the Mode (which owns exactly one ModeLine in v1) rather than
    # a mode_line row directly — snapshot data doesn't carry a separate
    # line-level id, and the 1:1 relationship makes this equivalent.
    mode_id_a: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    mode_id_b: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    rf_overlap_pct: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False)
    pw_overlap_pct: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False)
    pri_overlap_pct: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    pri_comparison_type: Mapped[str] = mapped_column(String(50), nullable=False)
    combined_severity: Mapped[AmbiguitySeverity] = mapped_column(nullable=False)
    details: Mapped[dict] = mapped_column(JSONB, nullable=False)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewer_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    run: Mapped["AmbiguityRun"] = relationship(back_populates="findings")
