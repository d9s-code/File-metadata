import uuid

from sqlalchemy import ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class EmitterScan(UUIDPkMixin, TimestampMixin, Base):
    """One of an Emitter's scans: how its antenna moves (circular, sector,
    raster, an ESA's beam dwells…) with what that pattern needs to work out
    how long the beam is on a target each look and how often it comes back.
    An Emitter has as many as the radar has; an operational mode uses one
    (and the ones under it inherit it), a Mode can use its own. For analysis
    and the dwell planner only: not exported (the XML's scan stays the EW
    Group's range)."""

    __tablename__ = "emitter_scans"

    emitter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("emitters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # One of schemas.emitter_scan.SCAN_PATTERNS ("circular", "raster", "esa"…).
    pattern: Mapped[str] = mapped_column(String(30), nullable=False)
    # The pattern's values, by name ("period_s": 10, "period_s_delta": 0.2…).
    params: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # The beam's 3 dB width (degrees), azimuth and elevation.
    beam_az_deg: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    beam_el_deg: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    # Typed in: wins over the worked-out illumination time (ms).
    illumination_ms: Mapped[float | None] = mapped_column(Numeric(12, 4), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    emitter: Mapped["Emitter"] = relationship(back_populates="scans")  # noqa: F821
