"""Audit action for downloading a backup

A downloaded backup is the whole database leaving the server, so who took one
is recorded in the Audit Log.

Revision ID: c8f2a6d1e9b3
Revises: b7d3f9a2c5e8
Create Date: 2026-10-03

"""
from typing import Sequence, Union

from alembic import op

revision: str = "c8f2a6d1e9b3"
down_revision: Union[str, None] = "b7d3f9a2c5e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'download'")


def downgrade() -> None:
    # Postgres can't drop a value from an enum type; an unused extra value is harmless.
    pass
