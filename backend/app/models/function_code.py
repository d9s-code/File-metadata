from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class FunctionCode(UUIDPkMixin, TimestampMixin, Base):
    """What kind of emitter an Emitter is (fire control, search, navigation…),
    from a list Admins keep. Every new Emitter gets one; the threat priority
    overview groups by it. Not part of an Emitter's saved versions or export.
    """

    __tablename__ = "function_codes"

    # Short and unique, e.g. "FC".
    code: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
