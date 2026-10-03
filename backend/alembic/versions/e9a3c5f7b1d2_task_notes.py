"""Task notes

A running log on each task — who noted what, when — added to by whoever works
on it.

Revision ID: e9a3c5f7b1d2
Revises: d4e7b1c9a2f5
Create Date: 2026-10-03

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "e9a3c5f7b1d2"
down_revision: Union[str, None] = "d4e7b1c9a2f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "task_notes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("author_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_task_notes_task_id"), "task_notes", ["task_id"])
    op.create_index(op.f("ix_task_notes_created_at"), "task_notes", ["created_at"])


def downgrade() -> None:
    op.drop_index(op.f("ix_task_notes_created_at"), table_name="task_notes")
    op.drop_index(op.f("ix_task_notes_task_id"), table_name="task_notes")
    op.drop_table("task_notes")
