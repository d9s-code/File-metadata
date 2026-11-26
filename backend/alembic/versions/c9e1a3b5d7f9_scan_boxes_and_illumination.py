"""A Mode's own scan period box (its function's min–max inside its EW Group's
scan range) and an Emitter's illumination time — both for the dwell planner.

Revision ID: c9e1a3b5d7f9
Revises: b8d0f2a4c6e8
Create Date: 2026-11-26
"""

import sqlalchemy as sa

from alembic import op

revision = "c9e1a3b5d7f9"
down_revision = "b8d0f2a4c6e8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Null everywhere to begin with: the planner falls back to the EW Group's
    # scan range and to the beamwidth setting, as it did before. Not exported.
    op.add_column("modes", sa.Column("scan_min_s", sa.Numeric(12, 4), nullable=True))
    op.add_column("modes", sa.Column("scan_max_s", sa.Numeric(12, 4), nullable=True))
    op.add_column("emitters", sa.Column("illumination_time_ms", sa.Numeric(12, 4), nullable=True))


def downgrade() -> None:
    op.drop_column("emitters", "illumination_time_ms")
    op.drop_column("modes", "scan_max_s")
    op.drop_column("modes", "scan_min_s")
