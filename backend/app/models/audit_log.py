import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import AuditAction
from app.database import Base
from app.models.mixins import UUIDPkMixin


class AuditLog(UUIDPkMixin, Base):
    """Append-only log of who changed what, when. Deliberately a single flat
    table (see docs/ROADMAP.md's Audit Trail proposal) — grouping/navigating
    by entity type and action is a client-side view over this flat log, not
    a schema-level hierarchy.
    """

    __tablename__ = "audit_log"
    __table_args__ = (Index("ix_audit_log_entity", "entity_type", "entity_id"),)

    # Null when the actor could not be identified (e.g. a failed login attempt
    # against an unknown username) or the acting user was later deleted.
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    action: Mapped[AuditAction] = mapped_column(nullable=False, index=True)
    # AuditEntityType value, kept as a plain string (not a DB enum) so new
    # entity types never require a migration — only the Python-level enum
    # that seeds the UI's group list needs updating.
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    # Denormalized rollup key: the Emitter this entry's entity belongs to (set
    # for emitter/ew_group/source/mode/mode_element/mode_generation_batch/
    # import_batch/emitter-scoped test_record entries; null for entries with
    # no owning Emitter, e.g. Platform/MDF/user/auth entries). Populated at
    # write time because some entities (Modes especially) are hard-deleted,
    # which would otherwise make "everything that happened under Emitter X"
    # unanswerable once a child row is gone.
    emitter_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("emitters.id", ondelete="SET NULL"), nullable=True, index=True
    )
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    changes: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    actor: Mapped["User | None"] = relationship()  # noqa: F821
