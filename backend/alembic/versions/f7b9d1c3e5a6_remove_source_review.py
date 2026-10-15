"""Sources are no longer reviewed: drop their approve/reject status and
rejection reason — every Source is usable as it is

Revision ID: f7b9d1c3e5a6
Revises: e6a8c0b2d4f5
Create Date: 2026-10-16

"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "f7b9d1c3e5a6"
down_revision: Union[str, None] = "e6a8c0b2d4f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("sources", "rejection_reason")
    op.drop_column("sources", "status")
    sa.Enum(name="sourcestatus").drop(op.get_bind(), checkfirst=True)


def downgrade() -> None:
    status = sa.Enum("approved", "pending_review", "rejected", name="sourcestatus")
    status.create(op.get_bind(), checkfirst=True)
    op.add_column("sources", sa.Column("status", status, server_default="approved", nullable=False))
    op.add_column("sources", sa.Column("rejection_reason", sa.Text(), nullable=True))
