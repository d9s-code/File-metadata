import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    func,
    Index,
    Integer,
    Numeric,
    String,
    text,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class Platform(UUIDPkMixin, TimestampMixin, Base):
    """Groups several Emitters; this — not the Emitter directly — is what
    gets pinned into an MDF.
    """

    __tablename__ = "platforms"

    # Unique among live rows only, so a soft-deleted row doesn't hold its
    # name hostage until it's purged.
    __table_args__ = (
        Index("uq_platforms_name_active", "name", unique=True, postgresql_where=text("NOT is_deleted")),
        CheckConstraint("hostility IN ('UNKNOWN', 'FRIEND', 'HOSTILE', 'NEUTRAL')", name="ck_platforms_hostility"),
        CheckConstraint("base IN ('SEA', 'GROUND', 'SUBSURFACE', 'UNKNOWN', 'AIR')", name="ck_platforms_base"),
        CheckConstraint("speed_unit IN ('kmh', 'knots')", name="ck_platforms_speed_unit"),
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # A status_definitions key; new Platforms start In progress.
    status: Mapped[str] = mapped_column(String(64), nullable=False, default="draft", server_default="draft")
    # As the PRS XML writes them: Hostility UNKNOWN, FRIEND, HOSTILE or NEUTRAL;
    # Base SEA, GROUND, SUBSURFACE, UNKNOWN or AIR. Both UNKNOWN to start.
    hostility: Mapped[str] = mapped_column(String(16), nullable=False, default="UNKNOWN", server_default="UNKNOWN")
    base: Mapped[str] = mapped_column(String(16), nullable=False, default="UNKNOWN", server_default="UNKNOWN")
    # How fast it moves, a range in speed_unit (km/h or knots); either end may
    # be unset. The PRS XML's Speed (Min, Max, Units).
    speed_min: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    speed_max: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    speed_unit: Mapped[str] = mapped_column(String(8), nullable=False, default="kmh", server_default="kmh")
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )

    links: Mapped[list["PlatformEmitterLink"]] = relationship(
        back_populates="platform", cascade="all, delete-orphan"
    )
    versions: Mapped[list["PlatformVersion"]] = relationship(
        back_populates="platform", cascade="all, delete-orphan", order_by="PlatformVersion.version_number"
    )


class PlatformEmitterLink(UUIDPkMixin, Base):
    """A Platform references a specific committed Emitter version, not the
    live draft — editing an Emitter never silently changes a Platform that
    already pinned an older version.
    """

    __tablename__ = "platform_emitter_links"
    __table_args__ = (UniqueConstraint("platform_id", "emitter_id", name="uq_platform_emitter"),)

    platform_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platforms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    emitter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("emitters.id", ondelete="CASCADE"), nullable=False
    )
    emitter_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("emitter_versions.id"), nullable=False
    )
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    platform: Mapped["Platform"] = relationship(back_populates="links")
    emitter: Mapped["Emitter"] = relationship()  # noqa: F821
    emitter_version: Mapped["EmitterVersion"] = relationship()  # noqa: F821


def platform_version_label(major: int | None, minor: int | None) -> str:
    """"3" for a whole version, "3.1" for a minor one."""
    if major is None:
        return "?"
    return f"{major}.{minor}" if minor else f"{major}"


class PlatformVersion(UUIDPkMixin, Base):
    __tablename__ = "platform_versions"
    __table_args__ = (UniqueConstraint("platform_id", "version_number", name="uq_platform_version_number"),)

    platform_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platforms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # The order versions were saved in (what links, routes and "outdated" go by).
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    # What people see: Save version makes the next whole version (v4), and
    # repinning an Emitter in the saved version a minor one (v3.1, v3.2).
    major: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    minor: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    change_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    platform: Mapped["Platform"] = relationship(back_populates="versions")
    # Who saved it — joined so a version list shows names without a query per row.
    creator: Mapped["User | None"] = relationship(lazy="joined", viewonly=True)  # noqa: F821

    @property
    def created_by_username(self) -> str | None:
        return self.creator.username if self.creator else None

    @property
    def emitter_count(self) -> int:
        """How many Emitters the version pins."""
        return len((self.snapshot or {}).get("links") or [])

    @property
    def version_label(self) -> str:
        return platform_version_label(self.major or self.version_number, self.minor)
