"""An operational mode's plan (its planned RF, PRI and PW values, for analysis)
and comments on the plan — threads on each operational mode and on the whole.

Revision ID: a4c6e8f0b2d5
Revises: f3b5d7e9a1c3
Create Date: 2026-11-27
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "a4c6e8f0b2d5"
down_revision = "f3b5d7e9a1c3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("operational_modes", sa.Column("plan", postgresql.JSONB(), nullable=True))
    op.create_table(
        "operational_mode_comments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("emitter_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("emitters.id", ondelete="CASCADE"), nullable=False),
        # Null: about the whole plan (or one since deleted — see operational_mode_name).
        sa.Column(
            "operational_mode_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("operational_modes.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("operational_mode_name", sa.String(200), nullable=True),
        sa.Column(
            "parent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("operational_mode_comments.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("author_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("resolved", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("resolved_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_operational_mode_comments_emitter_id", "operational_mode_comments", ["emitter_id"])
    op.create_index("ix_operational_mode_comments_operational_mode_id", "operational_mode_comments", ["operational_mode_id"])


def downgrade() -> None:
    op.drop_table("operational_mode_comments")
    op.drop_column("operational_modes", "plan")
