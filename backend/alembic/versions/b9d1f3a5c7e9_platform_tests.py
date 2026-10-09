"""Platform tests: every pinned Emitter tested in one run

Revision ID: b9d1f3a5c7e9
Revises: a7c9e1b3d5f6
Create Date: 2026-10-09

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision: str = "b9d1f3a5c7e9"
down_revision: Union[str, None] = "a7c9e1b3d5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "platform_tests",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "platform_id", UUID(as_uuid=True), sa.ForeignKey("platforms.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "platform_version_id",
            UUID(as_uuid=True),
            sa.ForeignKey("platform_versions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("test_type", sa.String(30), nullable=False),
        sa.Column("test_date", sa.Date(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("tested_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_platform_tests_platform_id", "platform_tests", ["platform_id"])

    op.add_column(
        "test_records",
        sa.Column(
            "platform_test_id",
            UUID(as_uuid=True),
            sa.ForeignKey("platform_tests.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_test_records_platform_test_id", "test_records", ["platform_test_id"])

    op.alter_column("test_run_drafts", "emitter_id", nullable=True)
    op.add_column(
        "test_run_drafts",
        sa.Column(
            "platform_id", UUID(as_uuid=True), sa.ForeignKey("platforms.id", ondelete="CASCADE"), nullable=True
        ),
    )
    op.create_index("ix_test_run_drafts_platform_id", "test_run_drafts", ["platform_id"])
    op.create_check_constraint(
        "ck_test_run_drafts_one_scope", "test_run_drafts", "num_nonnulls(emitter_id, platform_id) = 1"
    )


def downgrade() -> None:
    op.drop_constraint("ck_test_run_drafts_one_scope", "test_run_drafts", type_="check")
    op.execute("DELETE FROM test_run_drafts WHERE emitter_id IS NULL")
    op.drop_index("ix_test_run_drafts_platform_id", table_name="test_run_drafts")
    op.drop_column("test_run_drafts", "platform_id")
    op.alter_column("test_run_drafts", "emitter_id", nullable=False)
    op.drop_index("ix_test_records_platform_test_id", table_name="test_records")
    op.drop_column("test_records", "platform_test_id")
    op.drop_index("ix_platform_tests_platform_id", table_name="platform_tests")
    op.drop_table("platform_tests")
