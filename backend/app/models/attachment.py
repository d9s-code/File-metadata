"""Files kept with an Emitter, a Platform or an MDF — spreadsheets,
documents, photos, screenshots. Kept in the database (so backups and the
offline copy have them); a picture also gets a small preview on upload. Not
part of any version: like notes, they can be added without checking anything
out."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, LargeBinary, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, deferred, mapped_column, relationship

from app.database import Base
from app.models.mixins import UUIDPkMixin

#: What a file can belong to: the owner kind and its column.
OWNER_COLUMNS = {"emitter": "emitter_id", "platform": "platform_id", "mdf": "mdf_id"}


class Attachment(UUIDPkMixin, Base):
    __tablename__ = "attachments"
    __table_args__ = (
        CheckConstraint("num_nonnulls(emitter_id, platform_id, mdf_id) = 1", name="ck_attachments_one_owner"),
    )

    emitter_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("emitters.id", ondelete="CASCADE"), nullable=True, index=True
    )
    platform_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platforms.id", ondelete="CASCADE"), nullable=True, index=True
    )
    mdf_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("mdfs.id", ondelete="CASCADE"), nullable=True, index=True
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(127), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    # A picture this can show (checked on upload): it has a preview and a size.
    is_image: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # The order they are shown in, lowest first.
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # The file as uploaded, and a picture's preview — loaded only when asked for.
    data: Mapped[bytes] = deferred(mapped_column(LargeBinary, nullable=False))
    thumb: Mapped[bytes | None] = deferred(mapped_column(LargeBinary, nullable=True))
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    uploader: Mapped["User | None"] = relationship()  # noqa: F821

    @property
    def owner(self) -> tuple[str, uuid.UUID]:
        for kind, col in OWNER_COLUMNS.items():
            value = getattr(self, col)
            if value is not None:
                return kind, value
        raise ValueError("A file with no owner")
