"""Dwell files and their Dwell Strategies; app-wide settings

Revision ID: c3e5a7b9d1f2
Revises: b9d1f3a5c7e9
Create Date: 2026-10-15

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision: str = "c3e5a7b9d1f2"
down_revision: Union[str, None] = "b9d1f3a5c7e9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "dwell_files",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False, unique=True),
        sa.Column("mdf_id", UUID(as_uuid=True), sa.ForeignKey("mdfs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("timeout", sa.Float(), nullable=False, server_default="5"),
        sa.Column("setup_time", sa.Float(), nullable=False, server_default="5"),
        sa.Column("bandwidth_mhz", sa.Float(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_dwell_files_mdf_id", "dwell_files", ["mdf_id"])
    op.create_table(
        "dwell_strategies",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "dwell_file_id", UUID(as_uuid=True), sa.ForeignKey("dwell_files.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("platform_id", UUID(as_uuid=True), sa.ForeignKey("platforms.id", ondelete="SET NULL"), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("manual_collect_time_ms", sa.Float(), nullable=False, server_default="50"),
        sa.Column("merged_mode", JSONB(), nullable=False, server_default="[]"),
        sa.Column("rapid_df", JSONB(), nullable=True),
        sa.Column("split_mode", JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("dwell_file_id", "platform_id", name="uq_dwell_strategy_platform"),
    )
    op.create_index("ix_dwell_strategies_dwell_file_id", "dwell_strategies", ["dwell_file_id"])
    op.create_index("ix_dwell_strategies_platform_id", "dwell_strategies", ["platform_id"])
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(100), primary_key=True),
        sa.Column("value", JSONB(), nullable=False),
        sa.Column("updated_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("app_settings")
    op.drop_index("ix_dwell_strategies_platform_id", table_name="dwell_strategies")
    op.drop_index("ix_dwell_strategies_dwell_file_id", table_name="dwell_strategies")
    op.drop_table("dwell_strategies")
    op.drop_index("ix_dwell_files_mdf_id", table_name="dwell_files")
    op.drop_table("dwell_files")
