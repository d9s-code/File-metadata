import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.enums import Role
from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class User(UUIDPkMixin, TimestampMixin, Base):
    __tablename__ = "users"

    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[Role] = mapped_column(nullable=False, default=Role.viewer)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Sessions signed in before this are no longer accepted — set whenever the
    # password changes, so a changed (or reset) password signs out everywhere else.
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Each person's own settings — which optional features they see. Only
    # the keys in app.core.preferences mean anything; missing ones take
    # their default.
    preferences: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
