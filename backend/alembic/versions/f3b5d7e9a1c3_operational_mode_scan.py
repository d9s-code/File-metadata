"""An operational mode's scan period (s) — its Modes, and the ones below it,
take it unless a Mode has its own box (dwell planner; not exported).

Revision ID: f3b5d7e9a1c3
Revises: e2a4c6b8d0f1
Create Date: 2026-11-27
"""

import sqlalchemy as sa

from alembic import op

revision = "f3b5d7e9a1c3"
down_revision = "e2a4c6b8d0f1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Null on every existing one: its Modes keep the EW Group's range, as before.
    op.add_column("operational_modes", sa.Column("scan_min_s", sa.Numeric(12, 4), nullable=True))
    op.add_column("operational_modes", sa.Column("scan_max_s", sa.Numeric(12, 4), nullable=True))


def downgrade() -> None:
    op.drop_column("operational_modes", "scan_max_s")
    op.drop_column("operational_modes", "scan_min_s")
