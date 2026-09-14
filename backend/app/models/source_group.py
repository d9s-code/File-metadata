import uuid

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class SourceGroup(UUIDPkMixin, TimestampMixin, Base):
    """An optional cross-Emitter label for grouping Sources (e.g. by
    originating dataset) — orthogonal to a Source's owning Emitter, which
    stays the real scoping boundary.
    """

    __tablename__ = "source_groups"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    sources: Mapped[list["Source"]] = relationship(back_populates="group")  # noqa: F821
