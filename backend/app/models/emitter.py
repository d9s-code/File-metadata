import uuid

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import EmitterStatus
from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class Emitter(UUIDPkMixin, TimestampMixin, Base):
    __tablename__ = "emitters"

    name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False, index=True)
    designation: Mapped[str | None] = mapped_column(String(200), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[EmitterStatus] = mapped_column(nullable=False, default=EmitterStatus.draft)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )

    ew_groups: Mapped[list["EwGroup"]] = relationship(
        back_populates="emitter", cascade="all, delete-orphan", order_by="EwGroup.sort_order"
    )
    sources: Mapped[list["Source"]] = relationship(
        back_populates="emitter", cascade="all, delete-orphan"
    )
    versions: Mapped[list["EmitterVersion"]] = relationship(  # noqa: F821
        back_populates="emitter", cascade="all, delete-orphan", order_by="EmitterVersion.version_number"
    )
