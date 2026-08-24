import uuid

from sqlalchemy import ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class EwGroup(UUIDPkMixin, TimestampMixin, Base):
    __tablename__ = "ew_groups"

    emitter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("emitters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    scan_min: Mapped[float | None] = mapped_column(Numeric(12, 4), nullable=True)
    scan_max: Mapped[float | None] = mapped_column(Numeric(12, 4), nullable=True)
    threat_priority: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    emitter: Mapped["Emitter"] = relationship(back_populates="ew_groups")  # noqa: F821
    modes: Mapped[list["Mode"]] = relationship(  # noqa: F821
        back_populates="ew_group", cascade="all, delete-orphan", order_by="Mode.sort_order"
    )
