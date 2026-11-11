import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class PclRule(UUIDPkMixin, TimestampMixin, Base):
    """One Platform confidence rule (experimental): a condition on what's
    heard that gives a confidence level, 1 to 3, that it's this Platform.
    Kept apart from the Platform's versions and exports while experimental;
    changes are audited. The condition is stored parsed (app.services.pcl_expr),
    Emitters by id, and written out again with their current names."""

    __tablename__ = "pcl_rules"
    __table_args__ = (CheckConstraint("level BETWEEN 1 AND 3", name="ck_pcl_rules_level"),)

    platform_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platforms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    level: Mapped[int] = mapped_column(Integer, nullable=False)
    condition: Mapped[dict] = mapped_column(JSONB, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
