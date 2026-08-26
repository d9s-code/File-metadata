"""mode_line_deltas

Revision ID: d3f8a1c9e204
Revises: a1791090b6a3
Create Date: 2026-08-26 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd3f8a1c9e204'
down_revision: Union[str, None] = 'a1791090b6a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('mode_lines', sa.Column('rf_delta', sa.Numeric(precision=14, scale=4), nullable=True))
    op.add_column('mode_lines', sa.Column('pw_delta', sa.Numeric(precision=14, scale=4), nullable=True))
    op.add_column('mode_lines', sa.Column('pri_delta', sa.Numeric(precision=14, scale=4), nullable=True))


def downgrade() -> None:
    op.drop_column('mode_lines', 'pri_delta')
    op.drop_column('mode_lines', 'pw_delta')
    op.drop_column('mode_lines', 'rf_delta')
