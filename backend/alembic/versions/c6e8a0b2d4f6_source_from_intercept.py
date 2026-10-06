"""A Source can stand for an Intercept

"Turn into Source" on an Intercept makes a Source that stands for it, so
Modes can have the Intercept as their Source. One Source per Intercept; the
link clears if the Intercept is deleted (the Source and its Modes stay).

Revision ID: c6e8a0b2d4f6
Revises: b3d5f7a9c1e2
Create Date: 2026-10-06

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision: str = "c6e8a0b2d4f6"
down_revision: Union[str, None] = "b3d5f7a9c1e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sources",
        sa.Column("intercept_id", UUID(as_uuid=True), sa.ForeignKey("intercepts.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_sources_intercept_id", "sources", ["intercept_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_sources_intercept_id", table_name="sources")
    op.drop_column("sources", "intercept_id")
