import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import UUIDPkMixin


class EmitterNote(UUIDPkMixin, Base):
    """One append-only analyst-commentary entry on an Emitter. Immutable once
    written (no update endpoint) — an analyst adding a follow-up thought
    creates a new row rather than overwriting an earlier one, so the running
    commentary is never silently lost to a later edit.
    """

    __tablename__ = "emitter_notes"

    emitter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("emitters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    emitter: Mapped["Emitter"] = relationship(back_populates="notes")  # noqa: F821
    author: Mapped["User | None"] = relationship()  # noqa: F821
