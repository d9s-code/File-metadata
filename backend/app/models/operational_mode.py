import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    false,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class OperationalMode(UUIDPkMixin, TimestampMixin, Base):
    """One of a radar's operational modes (volume search, horizon search,
    track…), in a tree: TRACK can hold Track 1, 2, 3…, each of those more. The
    Emitter's Modes — its signals — are linked to the one they're transmitted
    in, and take what's set here from it: its scan (or, with none, its
    parent's), for illumination time and revisit in the dwell planner. Names are unique among
    siblings (checked by the app). App-only: not exported."""

    __tablename__ = "operational_modes"

    emitter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("emitters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # The one it sits under; None — at the top.
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("operational_modes.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # The scan it uses (one of its Emitter's); null: the one above it's.
    scan_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("emitter_scans.id", ondelete="SET NULL"), nullable=True, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Its plan, for analysis: the RF, PRI and PW values planned for it, several
    # each (see schemas.operational_mode.OperationalModePlan). A parameter it
    # doesn't plan comes from the one above it. Nothing about its Modes changes.
    plan: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    emitter: Mapped["Emitter"] = relationship(back_populates="operational_modes")  # noqa: F821


class OperationalModeComment(UUIDPkMixin, TimestampMixin, Base):
    """A comment on an Emitter's plan — on one operational mode, or (no
    operational mode) on the whole plan — or a reply to one. A top-level one
    can be marked resolved. Not part of the Emitter's versions."""

    __tablename__ = "operational_mode_comments"

    emitter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("emitters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    operational_mode_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("operational_modes.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Its name when commented on, to say what a comment was about once it's deleted.
    operational_mode_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("operational_mode_comments.id", ondelete="CASCADE"), nullable=True
    )
    author_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    resolved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    author: Mapped["User | None"] = relationship(foreign_keys=[author_id], viewonly=True)  # noqa: F821
    resolved_by: Mapped["User | None"] = relationship(foreign_keys=[resolved_by_id], viewonly=True)  # noqa: F821
