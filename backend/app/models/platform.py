import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class Platform(UUIDPkMixin, TimestampMixin, Base):
    """Groups several Emitters; this — not the Emitter directly — is what
    gets pinned into an MDF.
    """

    __tablename__ = "platforms"

    name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
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
        UUID(as_uuid=True), ForeignKey("emitters.id"), nullable=False
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


class PlatformVersion(UUIDPkMixin, Base):
    __tablename__ = "platform_versions"
    __table_args__ = (UniqueConstraint("platform_id", "version_number", name="uq_platform_version_number"),)

    platform_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platforms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    change_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    platform: Mapped["Platform"] = relationship(back_populates="versions")
