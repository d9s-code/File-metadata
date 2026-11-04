"""Intercept entries: a hypothesis — what the analyst thinks the group is

Revision ID: d1f3a5b7c9e2
Revises: c8e0a2b4d6f8
Create Date: 2026-11-04
"""

import sqlalchemy as sa
from alembic import op

revision = "d1f3a5b7c9e2"
down_revision = "c8e0a2b4d6f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("intercept_entries", sa.Column("hypothesis", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("intercept_entries", "hypothesis")
