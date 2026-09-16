"""add intercept to testtype enum

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-09-16 00:00:01.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Postgres can't DROP VALUE without a full type rebuild — no downgrade
    # for this, same accepted precedent as the auditaction enum additions.
    op.execute("ALTER TYPE testtype ADD VALUE IF NOT EXISTS 'intercept'")


def downgrade() -> None:
    pass
