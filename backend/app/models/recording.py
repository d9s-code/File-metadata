"""A whole recording — an EmitterTrackParameters CSV as uploaded, often 100 MB
and a million reports — kept on the server so it can be looked over, filtered
and snipped any time. Each snip is grouped and saved as an Intercept, which
remembers the recording and the snip it came from."""

import uuid
from datetime import datetime

from sqlalchemy import ARRAY, BigInteger, DateTime, Float, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import PriType
from app.database import Base
from app.models.mixins import UUIDPkMixin


class Recording(UUIDPkMixin, Base):
    __tablename__ = "recordings"

    # The file's name as uploaded.
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    # "uploading" → "processing" → "ready" (or "failed", with the reason in `error`).
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="uploading")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    report_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # A few of the lines that couldn't be read, and why: [[line, reason], …].
    skipped_sample: Mapped[list | None] = mapped_column(ARRAY(Text), nullable=True)
    first_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    uploader: Mapped["User | None"] = relationship()  # noqa: F821


class RecordingReport(Base):
    """One row of a recording — read as the CSV import reads it (times in µs,
    RF in MHz). Numbered, not UUIDs: there are a million of them per file."""

    __tablename__ = "recording_reports"
    __table_args__ = (
        Index("ix_recording_reports_time", "recording_id", "mission_time"),
        Index("ix_recording_reports_rf", "recording_id", "rf_mhz"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    recording_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("recordings.id", ondelete="CASCADE"), nullable=False
    )
    file_line: Mapped[int] = mapped_column(Integer, nullable=False)
    mission_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    track: Mapped[str | None] = mapped_column(String(50), nullable=True)
    mode_track: Mapped[str | None] = mapped_column(String(50), nullable=True)
    power: Mapped[float | None] = mapped_column(Float, nullable=True)
    designation: Mapped[str | None] = mapped_column(String(200), nullable=True)
    mode_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    ambiguity_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pri_type: Mapped[PriType] = mapped_column(nullable=False)
    rf_mhz: Mapped[float] = mapped_column(Float, nullable=False)
    # PRI, or a stagger's frame time; null for CW.
    pri_us: Mapped[float | None] = mapped_column(Float, nullable=True)
    pw_us: Mapped[float | None] = mapped_column(Float, nullable=True)
    jitter_us: Mapped[float | None] = mapped_column(Float, nullable=True)
    stagger_us: Mapped[list[float] | None] = mapped_column(ARRAY(Float), nullable=True)
