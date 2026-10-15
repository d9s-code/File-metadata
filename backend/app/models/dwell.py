import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class DwellStrategy(UUIDPkMixin, TimestampMixin, Base):
    """A Platform's dwell: its dwells (frequency and times, in order), the
    manual collect time, and RapidDF / Split Mode as a file had them. A
    Platform can have several (e.g. per season); dwell files pin saved
    versions of them, the way a Platform pins Emitter versions."""

    __tablename__ = "dwell_strategies"
    __table_args__ = (UniqueConstraint("platform_id", "name", name="uq_dwell_strategy_platform_name"),)

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # Null only for a Strategy imported from a file and not yet given its Platform.
    platform_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platforms.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # A line or two about it, shown in the lists.
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    manual_collect_time_ms: Mapped[float] = mapped_column(Float, nullable=False, default=50)
    # [{"freq_mhz", "dwell_time_ms", "collect_time_ms"}], in order.
    dwells: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # <RapidDF> attributes and <SplitMode> dwells exactly as in the file:
    # {"collect_time", "dwell_time", "freq"} and [{"collect_time", "dwell_time", "freqs": [...]}].
    rapid_df: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    split_mode: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # The band drawn around each dwell in its chart; none: the app-wide default.
    bandwidth_mhz: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    platform: Mapped["Platform | None"] = relationship()  # noqa: F821
    versions: Mapped[list["DwellStrategyVersion"]] = relationship(
        back_populates="strategy", cascade="all, delete-orphan", order_by="DwellStrategyVersion.version_number"
    )


class DwellStrategyVersion(UUIDPkMixin, Base):
    __tablename__ = "dwell_strategy_versions"
    __table_args__ = (UniqueConstraint("strategy_id", "version_number", name="uq_dwell_strategy_version_number"),)

    strategy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("dwell_strategies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    change_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    strategy: Mapped[DwellStrategy] = relationship(back_populates="versions")
    creator: Mapped["User | None"] = relationship(lazy="joined", viewonly=True)  # noqa: F821

    @property
    def created_by_username(self) -> str | None:
        return self.creator.username if self.creator else None


class DwellStrategyNote(UUIDPkMixin, Base):
    """One append-only analyst note on a Strategy — the same shape as
    PlatformNote."""

    __tablename__ = "dwell_strategy_notes"

    strategy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("dwell_strategies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    author: Mapped["User | None"] = relationship()  # noqa: F821


class DwellFile(UUIDPkMixin, TimestampMixin, Base):
    """A dwell file (`dwells/<name>.xml` in an MDF export): its settings and
    the Strategies in it — a saved version of each, at most one per Platform."""

    __tablename__ = "dwell_files"

    name: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    # The MDF whose export it goes into, if any.
    mdf_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("mdfs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # <Settings timeout setup_time>, as written in the file.
    timeout: Mapped[float] = mapped_column(Float, nullable=False, default=5)
    setup_time: Mapped[float] = mapped_column(Float, nullable=False, default=5)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    mdf: Mapped["Mdf | None"] = relationship()  # noqa: F821
    links: Mapped[list["DwellFileStrategy"]] = relationship(
        back_populates="dwell_file", cascade="all, delete-orphan", order_by="DwellFileStrategy.sort_order"
    )
    versions: Mapped[list["DwellFileVersion"]] = relationship(
        back_populates="dwell_file", cascade="all, delete-orphan", order_by="DwellFileVersion.version_number"
    )


class DwellFileStrategy(UUIDPkMixin, Base):
    """A Strategy in a dwell file: which saved version, and where in the file."""

    __tablename__ = "dwell_file_strategies"
    __table_args__ = (UniqueConstraint("dwell_file_id", "strategy_id", name="uq_dwell_file_strategy"),)

    dwell_file_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("dwell_files.id", ondelete="CASCADE"), nullable=False, index=True
    )
    strategy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("dwell_strategies.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    strategy_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("dwell_strategy_versions.id", ondelete="RESTRICT"), nullable=False
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    dwell_file: Mapped[DwellFile] = relationship(back_populates="links")
    strategy: Mapped[DwellStrategy] = relationship()
    strategy_version: Mapped[DwellStrategyVersion] = relationship()


class DwellFileVersion(UUIDPkMixin, Base):
    __tablename__ = "dwell_file_versions"
    __table_args__ = (UniqueConstraint("dwell_file_id", "version_number", name="uq_dwell_file_version_number"),)

    dwell_file_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("dwell_files.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    change_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    dwell_file: Mapped[DwellFile] = relationship(back_populates="versions")
    creator: Mapped["User | None"] = relationship(lazy="joined", viewonly=True)  # noqa: F821

    @property
    def created_by_username(self) -> str | None:
        return self.creator.username if self.creator else None
