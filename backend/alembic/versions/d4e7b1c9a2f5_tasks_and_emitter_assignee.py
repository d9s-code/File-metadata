"""Tasks, and who an Emitter is assigned to

A task is a to-do for yourself, for someone else, or for anyone to pick up,
optionally about one Emitter, Platform or MDF. emitters.assignee_id says who's
responsible for an Emitter.

Revision ID: d4e7b1c9a2f5
Revises: c8f2a6d1e9b3
Create Date: 2026-10-03

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "d4e7b1c9a2f5"
down_revision: Union[str, None] = "c8f2a6d1e9b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("assignee_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("done_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("entity_type", sa.String(length=20), nullable=True),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["assignee_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["done_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tasks_assignee_open", "tasks", ["assignee_id", "done_at"])
    op.create_index("ix_tasks_entity", "tasks", ["entity_type", "entity_id"])
    op.add_column("emitters", sa.Column("assignee_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index(op.f("ix_emitters_assignee_id"), "emitters", ["assignee_id"])
    op.create_foreign_key(
        "emitters_assignee_id_fkey", "emitters", "users", ["assignee_id"], ["id"], ondelete="SET NULL"
    )


def downgrade() -> None:
    op.drop_constraint("emitters_assignee_id_fkey", "emitters", type_="foreignkey")
    op.drop_index(op.f("ix_emitters_assignee_id"), table_name="emitters")
    op.drop_column("emitters", "assignee_id")
    op.drop_index("ix_tasks_entity", table_name="tasks")
    op.drop_index("ix_tasks_assignee_open", table_name="tasks")
    op.drop_table("tasks")
