"""create source_groups table

Revision ID: 6b0cd5302478
Revises: ec2859f3a031
Create Date: 2026-09-11 11:00:55.946452

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '6b0cd5302478'
down_revision: Union[str, None] = 'ec2859f3a031'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'source_groups',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('source_groups')
