import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import TestResult, TestScopeType, TestType
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

    test_record: Mapped["TestRecord"] = relationship(back_populates="modes")
    mode: Mapped["Mode"] = relationship()  # noqa: F821
