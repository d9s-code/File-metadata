"""CW Intercept entries

A CW (continuous wave) entry has RF only, so an entry's PRI and PW means
become optional.

Revision ID: e3a8c1f5b7d2
Revises: d7b4e2a9c6f1
Create Date: 2026-10-01

"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "e3a8c1f5b7d2"
down_revision: Union[str, None] = "d7b4e2a9c6f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("intercept_entries", "pri_mean_us", existing_type=sa.Numeric(14, 4), nullable=True)
    op.alter_column("intercept_entries", "pw_mean_us", existing_type=sa.Numeric(14, 4), nullable=True)


def downgrade() -> None:
    # CW entries have neither value and can't be kept under the old rule.
    op.execute("DELETE FROM intercept_entries WHERE pri_mean_us IS NULL OR pw_mean_us IS NULL")
    op.alter_column("intercept_entries", "pw_mean_us", existing_type=sa.Numeric(14, 4), nullable=False)
    op.alter_column("intercept_entries", "pri_mean_us", existing_type=sa.Numeric(14, 4), nullable=False)
