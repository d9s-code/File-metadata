"""Emitter checkpoints: saves made while editing, between versions

A checkpoint (v3.1, v3.2 …) is saved while editing and kept in history, but
isn't a version: only versions are pinned, exported and tested against. One
can be made into the next version.

Revision ID: c8e0a2b4d6f8
Revises: b6d8f0a2c4e6
Create Date: 2026-11-04

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c8e0a2b4d6f8"
down_revision: Union[str, None] = "b6d8f0a2c4e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "emitter_checkpoints",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("emitter_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("emitters.id", ondelete="CASCADE"), nullable=False),
        sa.Column("base_version_number", sa.Integer(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("change_summary", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("promoted_to_version_number", sa.Integer(), nullable=True),
        sa.UniqueConstraint("emitter_id", "base_version_number", "number", name="uq_emitter_checkpoint"),
    )
    op.create_index("ix_emitter_checkpoints_emitter_id", "emitter_checkpoints", ["emitter_id"])


def downgrade() -> None:
    op.drop_index("ix_emitter_checkpoints_emitter_id", table_name="emitter_checkpoints")
    op.drop_table("emitter_checkpoints")
