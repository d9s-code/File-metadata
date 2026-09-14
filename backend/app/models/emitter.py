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
    # Editing lock: null means anyone with editor role can check it out. Set
    # by /checkout, cleared by /checkout (release), /discard, or an Admin's
    # force-release. Not a data copy — the live rows stay the single source
    # of truth, this just gates who may mutate them right now.
    checked_out_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    checked_out_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Provenance only, for a forked Emitter — traceability/UI display, not
    # used by any versioning logic. SET NULL so deleting the source emitter
    # or version later doesn't affect the fork itself.
    forked_from_emitter_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("emitters.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Deliberately NOT a ForeignKey: emitters -> emitter_versions ->
    # emitters (EmitterVersion.emitter_id points back at us) is a genuine
    # two-table cycle. A real FK constraint here (even with use_alter, which
    # only fixes DDL create/drop ordering) was observed to disrupt
    # SQLAlchemy's flush-dependency ordering for entirely unrelated
    # insert/delete pairs in the same transaction (e.g. an audit_log insert
    # racing a hard Emitter delete). This column is purely a display/
    # traceability pointer for a forked Emitter — a dangling value if the
    # source version's Emitter is later hard-deleted is harmless and expected
    # (same as any other soft reference in this app), so trading away DB-level
    # referential integrity here is a deliberate, narrow exception.
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
    # No relationship() for checked_out_by_id/forked_from_emitter_id — every
    # caller (checkout_service, deps, emitter_summary_service) only ever
    # reads the raw *_id column directly, and a relationship() here was
    # observed, empirically, to disrupt SQLAlchemy's flush-dependency
    # ordering for entirely unrelated insert/delete pairs in the same
    # transaction (e.g. an audit_log insert racing a hard Emitter delete) —
    # the two extra FK-bearing relationships apparently gave the mapper
    # dependency graph a real ambiguity to trip over, even though neither
    # one participates in any cascade. Since nothing needs the loaded
    # relationship object, the column alone (with its FK/ondelete for DB-
    # level integrity) is both sufficient and safer.
