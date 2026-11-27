import uuid

from sqlalchemy import ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class OperationalMode(UUIDPkMixin, TimestampMixin, Base):
    """One of a radar's operational modes (volume search, horizon search,
    track…), in a tree: TRACK can hold Track 1, 2, 3…, each of those more. The
    Emitter's Modes — its signals — are linked to the one they're transmitted
    in, and take what's set here from it: for now its illumination time (or,
    with none, its parent's), for the dwell planner. Names are unique among
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
    # How long the beam lights up a Platform each scan in this operational
    # mode (ms). Null: its Emitter's illumination time, else the planner's beamwidth.
    illumination_time_ms: Mapped[float | None] = mapped_column(Numeric(12, 4), nullable=True)
    # The scan period (s) of this operational mode — its Modes' unless a Mode
    # has its own box; null: the one above it, else the EW Group's range.
    scan_min_s: Mapped[float | None] = mapped_column(Numeric(12, 4), nullable=True)
    scan_max_s: Mapped[float | None] = mapped_column(Numeric(12, 4), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    emitter: Mapped["Emitter"] = relationship(back_populates="operational_modes")  # noqa: F821
