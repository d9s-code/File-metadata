"""Test runs in progress, and Default Unknown as an intercepted-as result

A test run is saved as it's filled in (test_run_drafts), so it survives a
reload and can be finished later. A SIM line's result can record that the
system reported it as Default Unknown.

Revision ID: f3c5e7a9b1d2
Revises: e2b4d6f8a0c1
Create Date: 2026-10-07

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision: str = "f3c5e7a9b1d2"
down_revision: Union[str, None] = "e2b4d6f8a0c1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "test_record_lines",
        sa.Column("intercepted_as_unknown", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "test_run_drafts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("emitter_id", UUID(as_uuid=True), sa.ForeignKey("emitters.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("test_type", sa.String(30), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("state", JSONB(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_test_run_drafts_emitter_id", "test_run_drafts", ["emitter_id"])


def downgrade() -> None:
    op.drop_index("ix_test_run_drafts_emitter_id", table_name="test_run_drafts")
    op.drop_table("test_run_drafts")
    op.drop_column("test_record_lines", "intercepted_as_unknown")
