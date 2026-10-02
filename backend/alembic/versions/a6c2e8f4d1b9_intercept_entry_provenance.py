"""Intercept entry provenance

What an imported entry was built from, kept as data rather than only in its
note: when it was first and last heard, how many reports went into it, their
track numbers, and the file it came from (so a second import of the same
file can be caught). Null on entries typed in by hand.

Revision ID: a6c2e8f4d1b9
Revises: e3a8c1f5b7d2
Create Date: 2026-10-02

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "a6c2e8f4d1b9"
down_revision: Union[str, None] = "e3a8c1f5b7d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("intercept_entries", sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("intercept_entries", sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("intercept_entries", sa.Column("report_count", sa.Integer(), nullable=True))
    op.add_column("intercept_entries", sa.Column("tracks", postgresql.ARRAY(sa.String(50)), nullable=True))
    op.add_column("intercept_entries", sa.Column("source_file", sa.String(255), nullable=True))
    op.create_index("ix_intercept_entries_source_file", "intercept_entries", ["source_file"])


def downgrade() -> None:
    op.drop_index("ix_intercept_entries_source_file", table_name="intercept_entries")
    for column in ("source_file", "tracks", "report_count", "last_seen_at", "first_seen_at"):
        op.drop_column("intercept_entries", column)
