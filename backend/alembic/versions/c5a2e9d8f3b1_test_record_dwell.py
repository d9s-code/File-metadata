"""Dwell on test runs

A test run records the dwell it used: "Manual" or a written-in value.

Revision ID: c5a2e9d8f3b1
Revises: b3e8f1a4c9d2
Create Date: 2026-09-30

"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "c5a2e9d8f3b1"
down_revision: Union[str, None] = "b3e8f1a4c9d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("test_records", sa.Column("dwell", sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column("test_records", "dwell")
