import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import UUIDPkMixin


class CartesianRun(UUIDPkMixin, Base):
    """One run of a Source's cartesian Mode generation, kept as a log: what
    was combined (the Elements and Sequence steps, with the margins and range
    matching used), into which EW Group, and the Modes it made. Outlives its
    generation batch — deleting the batch's Modes leaves the entry, unlinked."""

    __tablename__ = "cartesian_runs"

    source_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sources.id", ondelete="CASCADE"), nullable=False, index=True
    )
    batch_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("mode_generation_batches.id", ondelete="SET NULL"), nullable=True
    )
    ew_group_name: Mapped[str] = mapped_column(String(200), nullable=False)
    name_prefix: Mapped[str] = mapped_column(String(200), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # {"elements": [...], "sequence_steps": [...], "range_matching": {...}}
    inputs: Mapped[dict] = mapped_column(JSONB, nullable=False)
    mode_names: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    creator: Mapped["User | None"] = relationship()  # noqa: F821
