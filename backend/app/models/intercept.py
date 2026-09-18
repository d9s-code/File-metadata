import uuid
from datetime import datetime

from sqlalchemy import ARRAY, DateTime, ForeignKey, Numeric, String, Text, func
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

    emitter: Mapped["Emitter"] = relationship(back_populates="intercepts")  # noqa: F821
    entries: Mapped[list["InterceptEntry"]] = relationship(
        back_populates="intercept", cascade="all, delete-orphan", order_by="InterceptEntry.created_at.desc()"
    )
    notes: Mapped[list["InterceptNote"]] = relationship(
        back_populates="intercept", cascade="all, delete-orphan", order_by="InterceptNote.created_at.desc()"
    )


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
    """One logged observation within an Intercept — create/delete only (no
    update endpoint), same precedent as ModeElement: a reading is either
    right or should be deleted and re-logged, not silently rewritten after a
    Mode may already have been derived from it.
    """

    __tablename__ = "intercept_entries"

    intercept_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("intercepts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Only fixed/stagger are meaningful for a logged intercept — enforced by
    # Pydantic (see schemas/intercept.py), not a separate DB enum.
    pri_type: Mapped[PriType] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    rf_min_mhz: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    rf_max_mhz: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    rf_mean_mhz: Mapped[float] = mapped_column(Numeric(14, 4), nullable=False)

    pw_min_us: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    pw_max_us: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    pw_mean_us: Mapped[float] = mapped_column(Numeric(14, 4), nullable=False)

    # Literal PRI mean when pri_type is fixed; the stagger frame-time mean
    # (same column, contextual meaning) when pri_type is stagger.
    pri_min_us: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    pri_max_us: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    pri_mean_us: Mapped[float] = mapped_column(Numeric(14, 4), nullable=False)

    # Fixed only — a single flat mean, not a min/max jitter bound.
    jitter_mean_us: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    # Stagger only (ordered) — same shape as ModeLine.pri_stagger_values_us.
    stagger_values: Mapped[list[float] | None] = mapped_column(ARRAY(Numeric(14, 4)), nullable=True)

    # Per-entry note, separate from the container's InterceptNote feed.
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

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
