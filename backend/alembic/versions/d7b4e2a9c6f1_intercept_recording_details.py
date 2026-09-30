"""Intercept recording date and collector

An Intercept records when the signal was recorded and by whom/what, apart
from when it was logged here.

Revision ID: d7b4e2a9c6f1
Revises: c5a2e9d8f3b1
Create Date: 2026-09-30

"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "d7b4e2a9c6f1"
down_revision: Union[str, None] = "c5a2e9d8f3b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("intercepts", sa.Column("intercepted_on", sa.Date(), nullable=True))
    op.add_column("intercepts", sa.Column("collected_by", sa.String(length=200), nullable=True))


def downgrade() -> None:
    op.drop_column("intercepts", "collected_by")
    op.drop_column("intercepts", "intercepted_on")
