"""A log of each Source's cartesian Mode generation runs

Revision ID: f5a7c9e1b3d4
Revises: e3c5d7f9b1a2
Create Date: 2026-10-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision: str = "f5a7c9e1b3d4"
down_revision: Union[str, None] = "e3c5d7f9b1a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "cartesian_runs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("source_id", UUID(as_uuid=True), sa.ForeignKey("sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "batch_id", UUID(as_uuid=True), sa.ForeignKey("mode_generation_batches.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("ew_group_name", sa.String(200), nullable=False),
        sa.Column("name_prefix", sa.String(200), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("inputs", JSONB(), nullable=False),
        sa.Column("mode_names", JSONB(), nullable=False),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_cartesian_runs_source_id", "cartesian_runs", ["source_id"])


def downgrade() -> None:
    op.drop_index("ix_cartesian_runs_source_id", table_name="cartesian_runs")
    op.drop_table("cartesian_runs")
