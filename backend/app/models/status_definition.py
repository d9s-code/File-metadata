import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.mixins import UUIDPkMixin


class StatusDefinition(UUIDPkMixin, Base):
    """One status an Emitter, Platform or MDF can be in — its name, colour,
    place in the order and the statuses it can move to, all set by Admins.
    Items store the `key`, which never changes; built-in ones (whose keys
    the app gives meaning to, e.g. `validated` = Operational) can be renamed
    and recoloured but not deleted."""

    __tablename__ = "status_definitions"
    __table_args__ = (UniqueConstraint("entity_type", "key", name="uq_status_definition_key"),)

    entity_type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    label: Mapped[str] = mapped_column(String(60), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False, default="grey")
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Keys of the statuses this one can move to.
    transitions: Mapped[list[str]] = mapped_column(ARRAY(String(64)), nullable=False, default=list)
    # Moving here asks for a note (e.g. what was validated), prompted with note_prompt.
    requires_note: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    note_prompt: Mapped[str | None] = mapped_column(String(200), nullable=True)


class MilestoneDefinition(UUIDPkMixin, Base):
    """Something to get done before an item reaches a status. With no
    `entity_id` it's a default, on every item of its type; with one, it's
    that item's own."""

    __tablename__ = "milestone_definitions"

    entity_type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    status_key: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class MilestoneCheck(UUIDPkMixin, Base):
    """A milestone ticked off on one item: by whom, when, and a note."""

    __tablename__ = "milestone_checks"
    __table_args__ = (UniqueConstraint("milestone_id", "entity_id", name="uq_milestone_check"),)

    milestone_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("milestone_definitions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    done_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    done_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
