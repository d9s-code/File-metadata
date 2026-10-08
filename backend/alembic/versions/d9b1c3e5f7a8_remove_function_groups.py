"""Function Groups are gone

Drops the Function Groups, each Mode's link to one, and the per-test
Function Group results. A downgrade brings back the empty tables and column
(the data itself is only in backups).

Revision ID: d9b1c3e5f7a8
Revises: c7f9a1b3d5e6
Create Date: 2026-10-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "d9b1c3e5f7a8"
down_revision: Union[str, None] = "c7f9a1b3d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table("test_record_function_groups")
    op.drop_index("ix_modes_function_group_id", table_name="modes")
    op.drop_column("modes", "function_group_id")
    op.drop_table("function_groups")


def downgrade() -> None:
    op.create_table(
        "function_groups",
        sa.Column("emitter_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["emitter_id"], ["emitters.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_function_groups_emitter_id", "function_groups", ["emitter_id"], unique=False)
    op.add_column(
        "modes",
        sa.Column(
            "function_group_id", sa.UUID(), sa.ForeignKey("function_groups.id", ondelete="SET NULL"), nullable=True
        ),
    )
    op.create_index("ix_modes_function_group_id", "modes", ["function_group_id"], unique=False)
    testresult = postgresql.ENUM(name="testresult", create_type=False)
    op.create_table(
        "test_record_function_groups",
        sa.Column("test_record_id", sa.UUID(), nullable=False),
        sa.Column("function_group_id", sa.UUID(), nullable=False),
        sa.Column("computed_result", testresult, nullable=False),
        sa.Column("override_result", testresult, nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(["function_group_id"], ["function_groups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["test_record_id"], ["test_records.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_test_record_function_groups_function_group_id",
        "test_record_function_groups",
        ["function_group_id"],
        unique=False,
    )
    op.create_index(
        "ix_test_record_function_groups_test_record_id", "test_record_function_groups", ["test_record_id"], unique=False
    )
