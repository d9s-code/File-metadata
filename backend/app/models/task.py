import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class Task(UUIDPkMixin, TimestampMixin, Base):
    """A to-do: for yourself (assigned to you), for someone else on the team,
    or for anyone to pick up (no assignee). Optionally about one Emitter,
    Platform or MDF. Open until marked done."""

    __tablename__ = "tasks"
    __table_args__ = (
        Index("ix_tasks_assignee_open", "assignee_id", "done_at"),
        Index("ix_tasks_entity", "entity_type", "entity_id"),
    )

    title: Mapped[str] = mapped_column(String(300), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    done_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # What it's about: "emitter", "platform" or "mdf" and that item's id. Not a
    # foreign key (it points at one of three tables); a link to an item that's
    # since been deleted for good just reads as gone.
    entity_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
