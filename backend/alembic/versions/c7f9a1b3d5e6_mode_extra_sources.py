"""A Mode can come from more than one Source

`modes.source_id` stays the first Source; `mode_extra_sources` holds the
rest, in order.

Revision ID: c7f9a1b3d5e6
Revises: b6e8f0a2c4d5
Create Date: 2026-10-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision: str = "c7f9a1b3d5e6"
down_revision: Union[str, None] = "b6e8f0a2c4d5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "mode_extra_sources",
        sa.Column("mode_id", UUID(as_uuid=True), sa.ForeignKey("modes.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("source_id", UUID(as_uuid=True), sa.ForeignKey("sources.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_mode_extra_sources_source_id", "mode_extra_sources", ["source_id"])


def downgrade() -> None:
    op.drop_index("ix_mode_extra_sources_source_id", table_name="mode_extra_sources")
    op.drop_table("mode_extra_sources")
