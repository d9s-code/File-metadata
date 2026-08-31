"""audit_action_restore

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-08-31 00:05:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'c2d3e4f5a6b7'
down_revision: Union[str, None] = 'b1c2d3e4f5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Postgres 12+ allows ADD VALUE inside a transaction as long as the new
    # value isn't used in that same transaction — true here, this migration
    # only adds it.
    op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'restore'")


def downgrade() -> None:
    # Postgres has no DROP VALUE for enum types; removing 'restore' would
    # require rebuilding the type. Left as a no-op, matching how this
    # codebase's other enum-adding migrations (if any) would have to behave.
    pass
