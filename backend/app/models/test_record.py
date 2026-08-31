import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import TestRecordModeLinkType, TestResult, TestScopeType, TestType
from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class TestRecord(UUIDPkMixin, TimestampMixin, Base):
    """A record of real-world validation (sim run, lab bench, live range,
    field exercise) — pinned to the *exact* Emitter or MDF version that was
    actually tested, so test history stays accurate as drafts keep changing.
    """

    __tablename__ = "test_records"

    scope_type: Mapped[TestScopeType] = mapped_column(nullable=False)
    scope_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    emitter_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("emitter_versions.id"), nullable=True
    )
    mdf_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("mdf_versions.id"), nullable=True
    )
    test_type: Mapped[TestType] = mapped_column(nullable=False)
    result: Mapped[TestResult] = mapped_column(nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    tested_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    test_date: Mapped[date] = mapped_column(Date, nullable=False)
    # Required for test_type == simulation only (see TestRecordCreate) — when the
    # simulation model/scenario itself was built, as distinct from test_date (when
    # the test run happened against it).
    simulation_created_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Optional pointer to an earlier test record this one re-runs. SET NULL (not
    # CASCADE): deleting the earlier test should drop the pointer, not the retest.
    retests_test_record_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_records.id", ondelete="SET NULL"), nullable=True
    )

    modes: Mapped[list["TestRecordMode"]] = relationship(
        back_populates="test_record", cascade="all, delete-orphan"
    )


class TestRecordMode(UUIDPkMixin, Base):
    __tablename__ = "test_record_modes"

    test_record_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_records.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # CASCADE: deleting a Mode just drops it from any test record's exercised-modes
    # list — the test record itself (and its result/notes/other linked Modes)
    # survives. Modes get regenerated/edited routinely, so a Mode being test-linked
    # must never block its own deletion.
    mode_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("modes.id", ondelete="CASCADE"), nullable=False
    )
    # 'exercised' (default, matches every link created before this column
    # existed): the Mode was tested as-is. 'derived': this test's findings are
    # why the Mode's values are what they are, rather than a Source's data.
    link_type: Mapped[TestRecordModeLinkType] = mapped_column(
        nullable=False, default=TestRecordModeLinkType.exercised, server_default=TestRecordModeLinkType.exercised.value
    )
    # Per-mode outcome and notes — what actually happened to *this* Mode
    # during the test. Null on rows created before this column existed, and
    # meaningless on a 'derived' link. TestRecord.result is derived from
    # these (see compute_overall_result) rather than picked independently, so
    # the whole-test result can never disagree with what was actually observed.
    result: Mapped[TestResult | None] = mapped_column(nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # What was actually measured for this Mode during the test — zero or more
    # sets (e.g. one per repeated measurement/run), each a subset of
    # {rf_min_mhz, rf_max_mhz, pw_min_us, pw_max_us, pri_type, pri_min_us,
    # pri_max_us, jitter_min_us, jitter_max_us, pri_stagger_values_us}.
    # Lightweight and partial by design — enough to note an anomaly and seed a
    # test-derived Mode's line, not a full replica of ModeLineFields.
    # Display-only, never queried/filtered — same JSONB convention as
    # ModeLine.type_data / AuditLog.changes / version snapshots.
    observed_values: Mapped[list[dict] | None] = mapped_column(JSONB, nullable=True)

    test_record: Mapped["TestRecord"] = relationship(back_populates="modes")
    mode: Mapped["Mode"] = relationship()  # noqa: F821
