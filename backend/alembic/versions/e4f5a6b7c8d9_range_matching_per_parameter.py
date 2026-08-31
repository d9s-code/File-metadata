"""range_matching_per_parameter

Corrects range_matching from a single per-Mode flag to three independent
per-parameter (RF/PW/PRI) line fields, governed by the same draft-propose/
approve workflow as any other line parameter.

Revision ID: e4f5a6b7c8d9
Revises: d3e4f5a6b7c8
Create Date: 2026-08-31 00:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e4f5a6b7c8d9'
down_revision: Union[str, None] = 'd3e4f5a6b7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = ('rf_range_matching', 'pw_range_matching', 'pri_range_matching')


def upgrade() -> None:
    op.drop_column('modes', 'range_matching')
    for col in _COLUMNS:
        op.add_column('mode_lines', sa.Column(col, sa.Boolean(), nullable=False, server_default=sa.false()))
        op.alter_column('mode_lines', col, server_default=None)


def downgrade() -> None:
    for col in _COLUMNS:
        op.drop_column('mode_lines', col)
    op.add_column('modes', sa.Column('range_matching', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.alter_column('modes', 'range_matching', server_default=None)
