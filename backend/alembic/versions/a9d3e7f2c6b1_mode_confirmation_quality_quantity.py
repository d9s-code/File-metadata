"""mode confirmation quality and quantity

Revision ID: a9d3e7f2c6b1
Revises: f8c1a2d3e4b5
Create Date: 2026-09-23 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a9d3e7f2c6b1'
down_revision: Union[str, None] = 'f8c1a2d3e4b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Existing Modes get the values the exports have always written for them.
    op.add_column('modes', sa.Column('confirmation_quality', sa.Integer(), server_default='100', nullable=False))
    op.add_column('modes', sa.Column('confirmation_quantity', sa.Integer(), server_default='2', nullable=False))


def downgrade() -> None:
    op.drop_column('modes', 'confirmation_quantity')
    op.drop_column('modes', 'confirmation_quality')
