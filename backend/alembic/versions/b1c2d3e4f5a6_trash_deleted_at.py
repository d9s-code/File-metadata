"""trash_deleted_at

Revision ID: b1c2d3e4f5a6
Revises: a2b3c4d5e6f7
Create Date: 2026-08-31 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, None] = 'a2b3c4d5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("emitters", "platforms", "mdfs")


def upgrade() -> None:
    for table in _TABLES:
        op.add_column(table, sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))
        # Backfill any row already soft-deleted before this migration, so it
        # gets a real retention countdown instead of an indefinite one.
        op.execute(f"UPDATE {table} SET deleted_at = now() WHERE is_deleted = true AND deleted_at IS NULL")


def downgrade() -> None:
    for table in _TABLES:
        op.drop_column(table, 'deleted_at')
