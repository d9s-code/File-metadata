"""A Fixed Mode line's jitter delta (±), like its RF, PRI and PW deltas.

Revision ID: b8d0f2a4c6e8
Revises: a7c9e1b3d5f7
Create Date: 2026-11-18
"""

import sqlalchemy as sa

from alembic import op

revision = "b8d0f2a4c6e8"
down_revision = "a7c9e1b3d5f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Null on every existing line: no delta, so nothing they match or export changes.
    op.add_column("mode_lines", sa.Column("jitter_delta", sa.Numeric(14, 4), nullable=True))


def downgrade() -> None:
    op.drop_column("mode_lines", "jitter_delta")
