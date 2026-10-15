import uuid

from sqlalchemy import Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class DwellFile(UUIDPkMixin, TimestampMixin, Base):
    """One dwell file (`dwells/<name>.xml` in an MDF export): its settings and
    one Dwell Strategy per Platform."""

    __tablename__ = "dwell_files"

    name: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    # The MDF whose export it goes into, if any.
    mdf_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("mdfs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # <Settings timeout setup_time>, as written in the file.
    timeout: Mapped[float] = mapped_column(Float, nullable=False, default=5)
    setup_time: Mapped[float] = mapped_column(Float, nullable=False, default=5)
    # The band drawn around each dwell in its chart; none: the app-wide default.
    bandwidth_mhz: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    mdf: Mapped["Mdf | None"] = relationship()  # noqa: F821
    strategies: Mapped[list["DwellStrategy"]] = relationship(
        back_populates="dwell_file", cascade="all, delete-orphan", order_by="DwellStrategy.sort_order"
    )


class DwellStrategy(UUIDPkMixin, TimestampMixin, Base):
    """One <Strategy> of a dwell file — the dwell of one Platform. Its Merged
    Mode dwells are edited in the app; RapidDF and Split Mode are kept as the
    file had them (or the defaults)."""

    __tablename__ = "dwell_strategies"
    __table_args__ = (UniqueConstraint("dwell_file_id", "platform_id", name="uq_dwell_strategy_platform"),)

    dwell_file_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("dwell_files.id", ondelete="CASCADE"), nullable=False, index=True
    )
    platform_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platforms.id", ondelete="SET NULL"), nullable=True, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    manual_collect_time_ms: Mapped[float] = mapped_column(Float, nullable=False, default=50)
    # [{"freq_mhz", "dwell_time_ms", "collect_time_ms"}], in order.
    merged_mode: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # <RapidDF> attributes and <SplitMode> dwells exactly as in the file:
    # {"collect_time", "dwell_time", "freq"} and [{"collect_time", "dwell_time", "freqs": [...]}].
    rapid_df: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    split_mode: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    dwell_file: Mapped[DwellFile] = relationship(back_populates="strategies")
    platform: Mapped["Platform | None"] = relationship()  # noqa: F821
