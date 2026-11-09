"""An intercept entry can be left out of coverage

An analyst can leave an entry out (clutter, another emitter, a bad
measurement): it stays on the Intercept but is never flagged as not
covered by any Mode.

Revision ID: e3b5d7f9a1c2
Revises: d2f4a6c8e0b1
"""

import sqlalchemy as sa

from alembic import op

revision = "e3b5d7f9a1c2"
down_revision = "d2f4a6c8e0b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "intercept_entries",
        sa.Column("left_out", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("intercept_entries", "left_out")
