"""Each person's own settings

Which optional features someone sees (the AI chat, the AI drafts), kept with
their account so they follow them to any browser.

Revision ID: e2b4d6f8a0c1
Revises: d8f0b2c4e6a8
Create Date: 2026-10-07

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "e2b4d6f8a0c1"
down_revision: Union[str, None] = "d8f0b2c4e6a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("preferences", JSONB(), nullable=False, server_default="{}"))


def downgrade() -> None:
    op.drop_column("users", "preferences")
