"""add group_id to sources

Revision ID: c020a1532c82
Revises: 6b0cd5302478
Create Date: 2026-09-11 11:17:43.500962

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c020a1532c82'
down_revision: Union[str, None] = '6b0cd5302478'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('sources', sa.Column('group_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'fk_sources_group_id',
        'sources',
        'source_groups',
        ['group_id'],
        ['id']
    )


def downgrade() -> None:
    op.drop_constraint('fk_sources_group_id', 'sources', type_='foreignkey')
    op.drop_column('sources', 'group_id')
