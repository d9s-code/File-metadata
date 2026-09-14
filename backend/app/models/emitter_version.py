import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import UUIDPkMixin


class EmitterVersion(UUIDPkMixin, Base):
    """Immutable snapshot of an Emitter (and its EW Groups/Sources/Modes) at
    the moment a 'Commit Version' action ran. The live emitters/... rows are
    the editable draft; this table is the append-only history.
    """

    __tablename__ = "emitter_versions"
    __table_args__ = (UniqueConstraint("emitter_id", "version_number", name="uq_emitter_version_number"),)

    emitter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("emitters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    change_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    emitter: Mapped["Emitter"] = relationship(back_populates="versions")  # noqa: F821
