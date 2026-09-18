import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import UUIDPkMixin


class MdfNote(UUIDPkMixin, Base):
    """One append-only analyst-commentary entry on an MDF. Same immutable,
    add-only shape as EmitterNote/SourceNote — see EmitterNote's docstring.
    """

    __tablename__ = "mdf_notes"

    mdf_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("mdfs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    mdf: Mapped["Mdf"] = relationship(back_populates="analyst_notes")  # noqa: F821
    author: Mapped["User | None"] = relationship()  # noqa: F821
