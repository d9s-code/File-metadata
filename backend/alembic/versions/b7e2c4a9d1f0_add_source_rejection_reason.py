"""add source rejection_reason

Revision ID: b7e2c4a9d1f0
Revises: d1f3db48d5f8
Create Date: 2026-09-23 08:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b7e2c4a9d1f0'
down_revision: Union[str, None] = 'd1f3db48d5f8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('sources', sa.Column('rejection_reason', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('sources', 'rejection_reason')
