import uuid
from sqlalchemy import String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin
from app.models.source import Source


class SourceGroup(UUIDPkMixin, TimestampMixin, Base):
    """A group used to categorize sources (e.g., 'CED', 'Intercepts')."""

    __tablename__ = "source_groups"

    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)

    sources: Mapped[list["Source"]] = relationship(back_populates="group")
