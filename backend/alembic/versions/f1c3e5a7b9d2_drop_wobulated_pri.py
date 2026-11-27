"""A wobulated PRI is no longer offered: any Mode saved with one is steady
again (its PRI behaviour removed; a signal left with nothing in it is none).
Versions saved with it keep it, and still read "PRI wobulated".

Revision ID: f1c3e5a7b9d2
Revises: e7a9c1d3f5b2
Create Date: 2026-11-27
"""

from alembic import op

revision = "f1c3e5a7b9d2"
down_revision = "e7a9c1d3f5b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE modes SET signal = signal - 'pri' WHERE signal -> 'pri' ->> 'kind' = 'wobulated'")
    op.execute("UPDATE modes SET signal = NULL WHERE signal = '{}'::jsonb")


def downgrade() -> None:
    # What it was isn't kept: nothing to bring back.
    pass
