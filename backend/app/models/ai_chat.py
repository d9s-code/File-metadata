import uuid

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class AiChat(UUIDPkMixin, TimestampMixin, Base):
    """One person's conversation with the AI chat, kept so it can be read
    again, carried on, renamed or deleted. Only its owner sees it."""

    __tablename__ = "ai_chats"
    __table_args__ = (Index("ix_ai_chats_user_updated", "user_id", "updated_at"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    # In order: {"role": "user" | "assistant", "content", "reply"?: the
    # answer's details as the chat endpoint returns them, "error"?: true}.
    messages: Mapped[list[dict]] = mapped_column(JSONB, nullable=False, default=list)
