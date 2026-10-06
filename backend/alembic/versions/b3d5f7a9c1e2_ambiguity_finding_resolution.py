"""What was done about an ambiguity finding

A finding can be handled from the ambiguity page — for now, by merging its
two Modes. What was done, by whom and when is kept with the finding, so the
page can say so until the check is run again.

Revision ID: b3d5f7a9c1e2
Revises: a1c4e7f9b2d3
Create Date: 2026-10-06

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "b3d5f7a9c1e2"
down_revision: Union[str, None] = "a1c4e7f9b2d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("ambiguity_findings", sa.Column("resolution", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("ambiguity_findings", "resolution")
