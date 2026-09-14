import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import ElementVariant
from app.database import Base
from app.models.mixins import UUIDPkMixin


class ParameterSequence(UUIDPkMixin, Base):
    """An ordered, multi-parameter, lockstep sequence belonging to a Source
    (e.g. a frequency/PRI dwell-and-switch table) — a step may set any subset
    of rf/pw/pri/scan values, plus an optional dwell duration. Distinct from
    ModeElement.stagger_values, which is a flat, single-parameter (PRI-only)
    array used for manual entry and the cartesian-product Mode generator; the
    two mechanisms are intentionally not merged.
    """

    __tablename__ = "parameter_sequences"

    source_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sources.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # A sequence has no single element_type (it's inherently multi-parameter),
    # so this reuses ElementVariant directly rather than pairing with ElementType.
    variant: Mapped[ElementVariant | None] = mapped_column(nullable=True)
    # Ordered array of sparse step objects, e.g.
    # [{"order": 0, "rf_mhz": 9500, "pri_us": 800, "dwell_s": 0.1}, {"order": 1, "rf_mhz": 9520}]
    # — shape validated at the Pydantic layer (ParameterSequenceStepIn), not the DB.
    steps: Mapped[list[dict]] = mapped_column(JSONB, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    source: Mapped["Source"] = relationship(back_populates="parameter_sequences")  # noqa: F821
