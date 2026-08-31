import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import SourceStatus
from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class Source(UUIDPkMixin, TimestampMixin, Base):
    """Groups Modes within an Emitter by data provenance and owns the
    mode_elements working pool those Modes are generated from. Scoped
    per-Emitter, not a global cross-emitter catalog.
    """

    __tablename__ = "sources"

    emitter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("emitters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # User-entered fact (e.g. date of the collection/report), independent of created_at/updated_at.
    source_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[SourceStatus] = mapped_column(
        nullable=False, default=SourceStatus.approved, server_default=SourceStatus.approved.value
    )
    # Which import run (if any) created this Source. Nullable — manually-created
    # Sources have no batch. SET NULL on batch deletion: a Source survives even
    # if its provenance record is later removed.
    import_batch_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("import_batches.id", ondelete="SET NULL"), nullable=True, index=True
    )

    emitter: Mapped["Emitter"] = relationship(back_populates="sources")  # noqa: F821
    modes: Mapped[list["Mode"]] = relationship(back_populates="source")  # noqa: F821
    elements: Mapped[list["ModeElement"]] = relationship(  # noqa: F821
        back_populates="source", cascade="all, delete-orphan", order_by="ModeElement.sort_order"
    )
    parameter_sequences: Mapped[list["ParameterSequence"]] = relationship(  # noqa: F821
        back_populates="source", cascade="all, delete-orphan", order_by="ParameterSequence.sort_order"
    )
    import_batch: Mapped["ImportBatch | None"] = relationship(back_populates="sources")  # noqa: F821
