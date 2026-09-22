import uuid

from sqlalchemy import ForeignKey, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class TestLine(UUIDPkMixin, TimestampMixin, Base):
    """One row of a simulated-signal reference table, manually imported for an
    Emitter — what a test run is checked against, distinct from the Emitter's
    own Modes: a Test Line is a claim about what the simulator will present
    ("this is Threat 3's high-PRF search"), not a description of the Emitter
    itself. `expected_mode_id` is an optional cross-reference for traceability
    only, never required — a Test Line can exist with nothing on this Emitter
    to point at yet. `expected_parameters` is a free-form, entirely optional
    JSON note (e.g. pasted-in frequency/PRI figures from the source table) —
    display-only, never validated or queried, so importing a table never
    forces the user to first model every column it happens to have.
    """

    __tablename__ = "test_lines"

    emitter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("emitters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str] = mapped_column(Text, nullable=False)
    # SET NULL: this is a traceability pointer, not ownership — a Mode being
    # deleted/regenerated must never take a Test Line (or its test history)
    # down with it.
    expected_mode_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("modes.id", ondelete="SET NULL"), nullable=True
    )
    expected_parameters: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Free-text batch label (e.g. a filename or "2026-09 threat table") — for
    # grouping an import's rows in the UI, nothing more.
    import_batch_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    imported_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )

    expected_mode: Mapped["Mode"] = relationship()  # noqa: F821
