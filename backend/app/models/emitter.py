import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import EmitterStatus
from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class Emitter(UUIDPkMixin, TimestampMixin, Base):
    __tablename__ = "emitters"

    name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False, index=True)
    designation: Mapped[str | None] = mapped_column(String(200), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[EmitterStatus] = mapped_column(nullable=False, default=EmitterStatus.draft)
    # Set from the required note when transitioning validated -> deprecated
    # ("Operational" -> "Needs rework"); cleared on any transition away from
    # deprecated, since a stale note on a since-fixed Emitter would mislead —
    # the note still lives on permanently in that transition's audit/version
    # history, this is only the "what's currently outstanding" indicator.
    rework_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    # Whole-Emitter edit lock — every mutating Emitter/EW-Group/Source/Mode
    # endpoint requires the caller to hold this (see require_emitter_checkout/
    # require_ew_group_checkout in app/deps.py). Replaces the old Mode-level
    # propose/approve/reject workflow with one lock at the Emitter level plus
    # instant edits underneath it.
    checked_out_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    checked_out_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    forked_from_emitter_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("emitters.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Deliberately NOT a ForeignKey (not even use_alter) and neither this nor
    # forked_from_emitter_id/checked_out_by_id gets a relationship() object —
    # every caller reads the raw _id column directly. A real FK here creates
    # a genuine emitters <-> emitter_versions cycle (EmitterVersion.emitter_id
    # already points back at Emitter), which empirically broke SQLAlchemy's
    # flush-dependency ordering for unrelated insert/delete pairs in the same
    # transaction (e.g. an audit_log insert racing a hard Emitter delete) —
    # intermittent, ~50% flaky, not caught by a single test run. This column
    # is a soft/display-only reference, like AuditLog.emitter_id.
    forked_from_version_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)

    ew_groups: Mapped[list["EwGroup"]] = relationship(
        back_populates="emitter", cascade="all, delete-orphan", order_by="EwGroup.sort_order"
    )
    sources: Mapped[list["Source"]] = relationship(
        back_populates="emitter", cascade="all, delete-orphan"
    )
    versions: Mapped[list["EmitterVersion"]] = relationship(  # noqa: F821
        back_populates="emitter", cascade="all, delete-orphan", order_by="EmitterVersion.version_number"
    )
    # Free-form analyst commentary — separate from `description` (what this
    # Emitter *is*) and `rework_note` (a specific required-fix flag): an
    # append-only log of an analyst's own running notes/observations, newest
    # first. Immutable entries (see EmitterNote) so a later note never
    # overwrites an earlier one.
    notes: Mapped[list["EmitterNote"]] = relationship(  # noqa: F821
        back_populates="emitter", cascade="all, delete-orphan", order_by="EmitterNote.created_at.desc()"
    )
