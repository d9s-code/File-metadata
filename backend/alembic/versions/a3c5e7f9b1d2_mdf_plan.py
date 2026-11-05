"""MDF due date, goals, progress log and release notes

Revision ID: a3c5e7f9b1d2
Revises: f1b3d5f7a9c2
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "a3c5e7f9b1d2"
down_revision = "f1b3d5f7a9c2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("mdfs", sa.Column("due_date", sa.Date(), nullable=True))
    op.add_column("mdf_versions", sa.Column("release_notes", sa.Text(), nullable=True))
    op.add_column("mdf_versions", sa.Column("release_notes_updated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "mdf_versions",
        sa.Column("release_notes_updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_table(
        "mdf_goals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("mdf_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("mdfs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("done_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("done_note", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_mdf_goals_mdf_id", "mdf_goals", ["mdf_id"])
    op.create_table(
        "mdf_log_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("mdf_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("mdfs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False, server_default="progress"),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("author_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_mdf_log_entries_mdf_id", "mdf_log_entries", ["mdf_id"])
    op.create_index("ix_mdf_log_entries_created_at", "mdf_log_entries", ["created_at"])


def downgrade() -> None:
    op.drop_table("mdf_log_entries")
    op.drop_table("mdf_goals")
    op.drop_column("mdf_versions", "release_notes_updated_by")
    op.drop_column("mdf_versions", "release_notes_updated_at")
    op.drop_column("mdf_versions", "release_notes")
    op.drop_column("mdfs", "due_date")
