import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import UUIDPkMixin


class SourceNote(UUIDPkMixin, Base):
    """One append-only analyst-commentary entry on a Source. Same immutable,
    add-only shape as EmitterNote — see that class's docstring.
    """

    __tablename__ = "source_notes"

    # Not a foreign key: kept when the Source goes (deleted, or a revert to a
    # version without it) and shown again when a revert or discard brings it
    # back with its id.
    source_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    source: Mapped["Source | None"] = relationship(  # noqa: F821
        primaryjoin="foreign(SourceNote.source_id) == Source.id", viewonly=True
    )
    author: Mapped["User | None"] = relationship()  # noqa: F821
