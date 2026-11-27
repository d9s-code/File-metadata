"""How a Mode's signal behaves (RF, PRI and PW behaviour, intra-pulse
modulation, polarisation) and an EW Group's ERP — for analysis only, never
exported.

Revision ID: e7a9c1d3f5b2
Revises: c8e0a2b4d6f9
Create Date: 2026-11-27
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "e7a9c1d3f5b2"
down_revision = "c8e0a2b4d6f9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Null on every existing one: plain (fixed RF, steady PRI, fixed PW), no ERP — as before.
    op.add_column("modes", sa.Column("signal", postgresql.JSONB, nullable=True))
    op.add_column("ew_groups", sa.Column("erp_min_dbm", sa.Numeric(8, 2), nullable=True))
    op.add_column("ew_groups", sa.Column("erp_max_dbm", sa.Numeric(8, 2), nullable=True))


def downgrade() -> None:
    op.drop_column("ew_groups", "erp_max_dbm")
    op.drop_column("ew_groups", "erp_min_dbm")
    op.drop_column("modes", "signal")
