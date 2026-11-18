"""What a Platform test or an MDF test observed, Emitter by Emitter: which
were on the air, whether each was detected (how soon, by which dwell), and
what it was reported as — itself, Default Unknown, or other Emitters (a
mix-up, optionally down to which Mode was taken for which). An MDF test also
keeps, per Platform presented, which Platform it was intercepted as.

Names are kept beside the ids, so a run still reads after an Emitter,
Platform or Mode is renamed or deleted."""

import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import UUIDPkMixin


class ScenarioEmitter(UUIDPkMixin, Base):
    """One Emitter on the air in a Platform test (or an MDF test)."""

    __tablename__ = "scenario_emitters"
    __table_args__ = (
        CheckConstraint("num_nonnulls(platform_test_id, mdf_test_record_id) = 1", name="ck_scenario_emitters_one_test"),
        CheckConstraint("time_to_detect_s IS NULL OR time_to_detect_s >= 0", name="ck_scenario_emitters_time"),
    )

    platform_test_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform_tests.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # An MDF test is an MDF-scope test record (so readiness and the MDF's
    # test history read it as before); these rows hang off it.
    mdf_test_record_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_records.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # The Platform it was on the air with (an MDF test presents several).
    platform_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    platform_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    emitter_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    emitter_name: Mapped[str] = mapped_column(Text, nullable=False)
    # Null: not recorded (an older Platform test, or left open).
    detected: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    time_to_detect_s: Mapped[float | None] = mapped_column(Numeric(12, 3), nullable=True)
    # The dwell of the run's Strategy version that caught it: its place (1, 2, …) and how it read.
    dwell_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dwell_label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    reported_self: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    reported_unknown: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # This Emitter's result in the run: worked out from the above, or set.
    result: Mapped[str | None] = mapped_column(String(20), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    reports: Mapped[list["ScenarioReport"]] = relationship(
        back_populates="scenario_emitter", cascade="all, delete-orphan", order_by="ScenarioReport.sort_order", lazy="selectin"
    )


class ScenarioReport(UUIDPkMixin, Base):
    """A mix-up: the Emitter on the air reported as another one — and, if
    known, which of its Modes was taken for which of the other's."""

    __tablename__ = "scenario_reports"

    scenario_emitter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("scenario_emitters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    reported_emitter_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    reported_emitter_name: Mapped[str] = mapped_column(Text, nullable=False)
    # In an MDF test: the Platform the reported Emitter belongs to.
    reported_platform_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    reported_platform_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    expected_mode: Mapped[str | None] = mapped_column(String(200), nullable=True)
    reported_mode: Mapped[str | None] = mapped_column(String(200), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    scenario_emitter: Mapped[ScenarioEmitter] = relationship(back_populates="reports")


class MdfTestPlatform(UUIDPkMixin, Base):
    """A Platform presented in an MDF test, and which Platform it was
    intercepted as, when that was recorded."""

    __tablename__ = "mdf_test_platforms"

    mdf_test_record_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_records.id", ondelete="CASCADE"), nullable=False, index=True
    )
    platform_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    platform_name: Mapped[str] = mapped_column(Text, nullable=False)
    intercepted_as_platform_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    intercepted_as_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Intercepted, but not as any Platform.
    intercepted_unknown: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
