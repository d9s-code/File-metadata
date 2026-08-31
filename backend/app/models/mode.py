import uuid
from datetime import datetime

from sqlalchemy import ARRAY, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import ElementType, ElementVariant, ModeStatus, PriType
from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class Mode(UUIDPkMixin, TimestampMixin, Base):
    __tablename__ = "modes"

    ew_group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ew_groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sources.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    pri_type: Mapped[PriType] = mapped_column(nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Which cartesian-product run (if any) generated this Mode. Nullable — modes created
    # manually or via a typed DSL line have no batch. SET NULL on batch delete since the
    # batch-delete endpoint removes the Modes explicitly rather than relying on cascade.
    generation_batch_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("mode_generation_batches.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[ModeStatus] = mapped_column(nullable=False, default=ModeStatus.approved, server_default=ModeStatus.approved.value)
    # Set only on a `draft` Mode: the `approved` Mode it proposes to replace.
    # SET NULL on the original's deletion — a dangling draft against a Mode
    # that no longer exists just becomes an ordinary standalone draft rather
    # than being force-deleted itself.
    supersedes_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("modes.id", ondelete="SET NULL"), nullable=True, index=True
    )

    ew_group: Mapped["EwGroup"] = relationship(back_populates="modes")  # noqa: F821
    source: Mapped["Source"] = relationship(back_populates="modes")  # noqa: F821
    line: Mapped["ModeLine | None"] = relationship(
        back_populates="mode", cascade="all, delete-orphan", uselist=False
    )
    generation_batch: Mapped["ModeGenerationBatch | None"] = relationship(back_populates="modes")
    supersedes: Mapped["Mode | None"] = relationship(remote_side="Mode.id", foreign_keys=[supersedes_id])


class ModeLine(UUIDPkMixin, Base):
    """The single generated/typed parameter row for a Mode (v1: one mode = one line)."""

    __tablename__ = "mode_lines"
    __table_args__ = ()

    mode_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("modes.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    rf_min_mhz: Mapped[float] = mapped_column(Numeric(14, 4), nullable=False)
    rf_max_mhz: Mapped[float] = mapped_column(Numeric(14, 4), nullable=False)
    pw_min_us: Mapped[float] = mapped_column(Numeric(14, 4), nullable=False)
    pw_max_us: Mapped[float] = mapped_column(Numeric(14, 4), nullable=False)

    # Symmetric +/- tolerance margin per parameter, applied to the raw min/max above to
    # derive the engineered value — same raw-vs-engineered pattern as ModeElement.delta
    # and EwGroup.scan_delta. Required for manually-authored lines (see ModeCreate);
    # left null for DSL-parsed/cartesian-generated lines, which carry no raw value since
    # the cartesian path already bakes each element's delta into rf_min_mhz/etc.
    rf_delta: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    pw_delta: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    pri_delta: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)

    # Fixed only
    pri_min_us: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    pri_max_us: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    jitter_min_us: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    jitter_max_us: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)

    # Stagger only (ordered)
    pri_stagger_values_us: Mapped[list[float] | None] = mapped_column(ARRAY(Numeric(14, 4)), nullable=True)

    # Xlet + future PRI-type fields
    type_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    dsl_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    mode: Mapped["Mode"] = relationship(back_populates="line")


class ModeElement(UUIDPkMixin, Base):
    """Working pool of RF/PW/PRI/Scan building blocks, scoped to a Source, used
    by the cartesian-product and frametime tools to generate batches of Modes.
    """

    __tablename__ = "mode_elements"

    source_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sources.id", ondelete="CASCADE"), nullable=False, index=True
    )
    element_type: Mapped[ElementType] = mapped_column(nullable=False)
    # Which measurement basis this row represents (typical/discrete/most_probable/
    # extreme) — set on imported Elements, left null for manually-entered ones.
    variant: Mapped[ElementVariant | None] = mapped_column(nullable=True)
    value_min: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    value_max: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    stagger_values: Mapped[list[float] | None] = mapped_column(ARRAY(Numeric(14, 4)), nullable=True)
    jitter_min: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    jitter_max: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    # Symmetric +/- tolerance margin applied to value_min/value_max to derive the
    # engineered value used downstream; value_min/value_max stay the raw, as-typed
    # source value. Not applicable to stagger PRI elements.
    delta: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    source: Mapped["Source"] = relationship(back_populates="elements")  # noqa: F821


class ModeGenerationBatch(UUIDPkMixin, Base):
    """One cartesian-product run. Every Mode it created is tagged with this id, so the
    batch stays identifiable/filterable/bulk-deletable even after individual Modes are
    renamed — the only thing tying a run together before this was the shared name prefix.
    """

    __tablename__ = "mode_generation_batches"

    ew_group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ew_groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sources.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name_prefix: Mapped[str] = mapped_column(String(200), nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    modes: Mapped[list["Mode"]] = relationship(back_populates="generation_batch")
    ew_group: Mapped["EwGroup"] = relationship()  # noqa: F821
