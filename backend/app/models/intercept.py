import uuid
from datetime import date, datetime

from sqlalchemy import ARRAY, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import PriType
from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class Intercept(UUIDPkMixin, TimestampMixin, Base):
    """A logged real-world signal intercept — a container for one or more
    InterceptEntry readings taken over time, scoped to an Emitter but also
    globally browsable/searchable on its own (see routers/intercepts.py).
    """

    __tablename__ = "intercepts"

    emitter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("emitters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # When the signal was actually recorded — created_at is only when it was
    # logged here. Null on Intercepts logged before this existed.
    intercepted_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Who/what recorded it, free text (e.g. "P-8A / ESM suite").
    collected_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Bumped whenever which report is in which entry changes (an import, a
    # regroup, a merge, a delete) — a regroup saved against an older version
    # is refused rather than silently undoing someone else's.
    grouping_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    emitter: Mapped["Emitter"] = relationship(back_populates="intercepts")  # noqa: F821
    # The Source made from it with "Turn into Source", if any.
    source: Mapped["Source | None"] = relationship(back_populates="intercept", uselist=False)  # noqa: F821
    entries: Mapped[list["InterceptEntry"]] = relationship(
        back_populates="intercept", cascade="all, delete-orphan", order_by="InterceptEntry.created_at.desc()"
    )
    notes: Mapped[list["InterceptNote"]] = relationship(
        back_populates="intercept", cascade="all, delete-orphan", order_by="InterceptNote.created_at.desc()"
    )
    # Deleted with the Intercept by the database (ON DELETE CASCADE) — there
    # can be tens of thousands, so they're never loaded just to delete them.
    reports: Mapped[list["InterceptReport"]] = relationship(
        back_populates="intercept", cascade="all, delete-orphan", passive_deletes=True
    )

    @property
    def source_id(self):
        return self.source.id if self.source is not None else None

    @property
    def source_name(self) -> str | None:
        return self.source.name if self.source is not None else None

    @property
    def source_status(self) -> str | None:
        return self.source.status.value if self.source is not None else None


class InterceptNote(UUIDPkMixin, Base):
    """One append-only analyst-commentary entry on an Intercept container —
    same shape/semantics as EmitterNote/SourceNote.
    """

    __tablename__ = "intercept_notes"

    intercept_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("intercepts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    intercept: Mapped["Intercept"] = relationship(back_populates="notes")
    author: Mapped["User | None"] = relationship()  # noqa: F821


class InterceptEntry(UUIDPkMixin, Base):
    """One logged observation within an Intercept. Corrected in place by a
    full replace (see routers/intercepts.py), which keeps its id and so its
    link to any Mode created from it — that Mode's own values don't change.
    """

    __tablename__ = "intercept_entries"

    intercept_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("intercepts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # fixed, stagger or cw (X-let isn't supported yet) — enforced by Pydantic
    # (see schemas/intercept.py), not a separate DB enum.
    pri_type: Mapped[PriType] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    rf_min_mhz: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    rf_max_mhz: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    rf_mean_mhz: Mapped[float] = mapped_column(Numeric(14, 4), nullable=False)

    pw_min_us: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    pw_max_us: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    # Null for a CW entry — a continuous wave has no pulses.
    pw_mean_us: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)

    # Literal PRI mean when pri_type is fixed; the stagger frame-time mean
    # (same column, contextual meaning) when pri_type is stagger. Null for CW.
    pri_min_us: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    pri_max_us: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    pri_mean_us: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)

    # Fixed only — a single flat mean, not a min/max jitter bound.
    jitter_mean_us: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    # Stagger only (ordered) — same shape as ModeLine.pri_stagger_values_us.
    stagger_values: Mapped[list[float] | None] = mapped_column(ARRAY(Numeric(14, 4)), nullable=True)

    # Per-entry note, separate from the container's InterceptNote feed.
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # What an imported entry was built from — null on entries typed in by
    # hand. Times are mission times as written in the file, stored as UTC.
    first_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    report_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tracks: Mapped[list[str] | None] = mapped_column(ARRAY(String(50)), nullable=True)
    # The file it was imported from — how a second import of the same file is caught.
    source_file: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)

    intercept: Mapped["Intercept"] = relationship(back_populates="entries")
    modes: Mapped[list["InterceptEntryMode"]] = relationship(
        back_populates="intercept_entry", cascade="all, delete-orphan"
    )


class InterceptEntryMode(UUIDPkMixin, Base):
    """Links an InterceptEntry to a Mode it was used to derive — every row
    unambiguously means "derived from" (unlike TestRecordMode, no separate
    link_type is needed since an Intercept entry has no "exercised" concept).
    """

    __tablename__ = "intercept_entry_modes"

    intercept_entry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("intercept_entries.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # CASCADE: deleting a Mode just drops it from the entry's produced-Modes
    # list, same reasoning as TestRecordMode.mode_id.
    mode_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("modes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    intercept_entry: Mapped["InterceptEntry"] = relationship(back_populates="modes")
    mode: Mapped["Mode"] = relationship()  # noqa: F821


class InterceptReport(UUIDPkMixin, Base):
    """One report from an imported file — a single measurement the system
    made — kept so an Intercept's entries can be traced back to what they
    were built from, and regrouped. In at most one entry; none means it was
    left out (or its entry was deleted, which leaves the report here)."""

    __tablename__ = "intercept_reports"

    intercept_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("intercepts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    entry_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("intercept_entries.id", ondelete="SET NULL"), nullable=True, index=True
    )
    source_file: Mapped[str | None] = mapped_column(String(255), nullable=True)
    file_line: Mapped[int] = mapped_column(Integer, nullable=False)
    # Mission time as written in the file, stored as UTC.
    mission_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    track: Mapped[str | None] = mapped_column(String(50), nullable=True)
    mode_track: Mapped[str | None] = mapped_column(String(50), nullable=True)
    power: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    # What the system identified it as.
    designation: Mapped[str | None] = mapped_column(String(200), nullable=True)
    mode_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    ambiguity_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pri_type: Mapped[PriType] = mapped_column(nullable=False)
    rf_mhz: Mapped[float] = mapped_column(Numeric(14, 4), nullable=False)
    # PRI, or a stagger's frame time; null for CW.
    pri_us: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    pw_us: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    jitter_us: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    stagger_us: Mapped[list[float] | None] = mapped_column(ARRAY(Numeric(14, 4)), nullable=True)

    intercept: Mapped["Intercept"] = relationship(back_populates="reports")
