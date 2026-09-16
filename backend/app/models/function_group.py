import uuid

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class FunctionGroup(UUIDPkMixin, TimestampMixin, Base):
    """A per-Emitter grouping of Modes by the function they serve (e.g.
    'Search', 'Track', 'Guidance') — independent of EW Group, which groups
    Modes by scan/threat parameters instead. Used to organize testing: a
    test session rates each represented Function Group's performance as a
    whole rather than every Mode individually.
    """

    __tablename__ = "function_groups"

    emitter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("emitters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    emitter: Mapped["Emitter"] = relationship()  # noqa: F821
    modes: Mapped[list["Mode"]] = relationship(back_populates="function_group")  # noqa: F821
