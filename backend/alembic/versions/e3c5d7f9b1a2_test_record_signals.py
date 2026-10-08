"""Intercept Tests log signals that aren't tied to a Mode

Revision ID: e3c5d7f9b1a2
Revises: d9b1c3e5f7a8
Create Date: 2026-10-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision: str = "e3c5d7f9b1a2"
down_revision: Union[str, None] = "d9b1c3e5f7a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "test_record_signals",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "test_record_id",
            UUID(as_uuid=True),
            sa.ForeignKey("test_records.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("observed_values", JSONB(), nullable=False),
        sa.Column("reported_as_unknown", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.create_index("ix_test_record_signals_test_record_id", "test_record_signals", ["test_record_id"])


def downgrade() -> None:
    op.drop_index("ix_test_record_signals_test_record_id", table_name="test_record_signals")
    op.drop_table("test_record_signals")
