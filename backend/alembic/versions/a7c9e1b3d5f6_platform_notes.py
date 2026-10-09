"""Analyst notes on Platforms

Revision ID: a7c9e1b3d5f6
Revises: f5a7c9e1b3d4
Create Date: 2026-10-09

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision: str = "a7c9e1b3d5f6"
down_revision: Union[str, None] = "f5a7c9e1b3d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "platform_notes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "platform_id", UUID(as_uuid=True), sa.ForeignKey("platforms.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("author_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_platform_notes_platform_id", "platform_notes", ["platform_id"])
    op.create_index("ix_platform_notes_created_at", "platform_notes", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_platform_notes_created_at", table_name="platform_notes")
    op.drop_index("ix_platform_notes_platform_id", table_name="platform_notes")
    op.drop_table("platform_notes")
