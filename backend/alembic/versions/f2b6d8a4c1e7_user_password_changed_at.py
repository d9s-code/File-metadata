"""When a user's password last changed

Sessions signed in before it are refused, so changing (or resetting) a
password signs that account out everywhere else.

Revision ID: f2b6d8a4c1e7
Revises: e9a3c5f7b1d2
Create Date: 2026-10-05

"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "f2b6d8a4c1e7"
down_revision: Union[str, None] = "e9a3c5f7b1d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "password_changed_at")
