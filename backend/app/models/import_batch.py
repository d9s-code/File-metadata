import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import UUIDPkMixin


class ImportBatch(UUIDPkMixin, Base):
    """One remote-agent import run against a single source document (a vendor
    XML file parsed elsewhere into our JSON contract). Pure provenance/grouping
    metadata — carries no status of its own; overall progress is a derived
    count of its Sources' SourceStatus values.
    """

    __tablename__ = "import_batches"

    emitter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("emitters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    document_name: Mapped[str] = mapped_column(String(300), nullable=False)
    document_reference: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    emitter: Mapped["Emitter"] = relationship()  # noqa: F821
    sources: Mapped[list["Source"]] = relationship(back_populates="import_batch")  # noqa: F821
