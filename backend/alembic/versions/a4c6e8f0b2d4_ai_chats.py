"""Saved AI chats

Each person's conversations with the AI chat, kept so they can be read
again, carried on, renamed or deleted (until now a chat lived only in the
browser tab).

Revision ID: a4c6e8f0b2d4
Revises: f3b5d7e9a1c2
Create Date: 2026-10-21

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a4c6e8f0b2d4"
down_revision: Union[str, None] = "f3b5d7e9a1c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ai_chats",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("messages", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_ai_chats_user_updated", "ai_chats", ["user_id", "updated_at"])


def downgrade() -> None:
    op.drop_index("ix_ai_chats_user_updated", table_name="ai_chats")
    op.drop_table("ai_chats")
