import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import MdfStatus
from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class Mdf(UUIDPkMixin, TimestampMixin, Base):
    """A Mission Data File — the deployable artifact. Links to Platforms
    (not Emitters directly): its referenced emitters are whatever the
    pinned Platform versions themselves reference.
    """

    __tablename__ = "mdfs"

    name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[MdfStatus] = mapped_column(nullable=False, default=MdfStatus.draft)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )

    links: Mapped[list["MdfPlatformLink"]] = relationship(back_populates="mdf", cascade="all, delete-orphan")
    versions: Mapped[list["MdfVersion"]] = relationship(
        back_populates="mdf", cascade="all, delete-orphan", order_by="MdfVersion.version_number"
    )


class MdfPlatformLink(UUIDPkMixin, Base):
    __tablename__ = "mdf_platform_links"
    __table_args__ = (UniqueConstraint("mdf_id", "platform_id", name="uq_mdf_platform"),)

    mdf_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("mdfs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    platform_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platforms.id"), nullable=False
    )
    platform_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform_versions.id"), nullable=False
    )
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    mdf: Mapped["Mdf"] = relationship(back_populates="links")
    platform: Mapped["Platform"] = relationship()  # noqa: F821
    platform_version: Mapped["PlatformVersion"] = relationship()  # noqa: F821


class MdfVersion(UUIDPkMixin, Base):
    __tablename__ = "mdf_versions"
    __table_args__ = (UniqueConstraint("mdf_id", "version_number", name="uq_mdf_version_number"),)

    mdf_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("mdfs.id", ondelete="CASCADE"), nullable=False, index=True
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

    mdf: Mapped["Mdf"] = relationship(back_populates="versions")
