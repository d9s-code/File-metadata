import uuid

from sqlalchemy import ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class OperationalMode(UUIDPkMixin, TimestampMixin, Base):
    """One of a radar's operational modes (volume search, horizon search,
    track…). The Emitter's Modes — its signals — are linked to the operational
    mode they're transmitted in, and take what's set here from it: for now its
    illumination time, for the dwell planner. App-only: not exported."""

    __tablename__ = "operational_modes"
    __table_args__ = (UniqueConstraint("emitter_id", "name", name="uq_operational_mode_emitter_name"),)

    emitter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("emitters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # How long the beam lights up a Platform each scan in this operational
    # mode (ms). Null: its Emitter's illumination time, else the planner's beamwidth.
    illumination_time_ms: Mapped[float | None] = mapped_column(Numeric(12, 4), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    emitter: Mapped["Emitter"] = relationship(back_populates="operational_modes")  # noqa: F821
