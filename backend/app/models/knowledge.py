from datetime import datetime

from sqlalchemy import Computed, DateTime, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.mixins import UUIDPkMixin


class KnowledgeSection(UUIDPkMixin, Base):
    """One section of the documentation the language model may be given — a
    copy of a piece of an Outline page, split at its headings. Rebuilt from
    Outline on each sync; nothing here is edited in the app."""

    __tablename__ = "knowledge_sections"
    __table_args__ = (Index("ix_knowledge_sections_search", "search", postgresql_using="gin"),)

    outline_doc_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    # Where it sits: "Page › Heading › Subheading" — what the model cites.
    path: Mapped[str] = mapped_column(Text, nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    # Its place in the documentation, to hand sections over in reading order.
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    page_updated_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    search = mapped_column(
        TSVECTOR, Computed("to_tsvector('simple', path || ' ' || text)", persisted=True), nullable=True
    )


class KnowledgeSync(Base):
    """The one row saying what was last copied from Outline, and when — or
    what went wrong the last time it was tried."""

    __tablename__ = "knowledge_sync"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    label: Mapped[str | None] = mapped_column(Text, nullable=True)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pages: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sections: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tried_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
