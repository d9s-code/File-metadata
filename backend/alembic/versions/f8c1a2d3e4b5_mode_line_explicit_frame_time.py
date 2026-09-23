"""mode line explicit frame time

Revision ID: f8c1a2d3e4b5
Revises: e4b9d2c7a1f3
Create Date: 2026-09-23 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f8c1a2d3e4b5'
down_revision: Union[str, None] = 'e4b9d2c7a1f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('mode_lines', sa.Column('explicit_frame_time_us', sa.Numeric(precision=14, scale=4), nullable=True))


def downgrade() -> None:
    op.drop_column('mode_lines', 'explicit_frame_time_us')
