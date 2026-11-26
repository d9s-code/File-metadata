"""Operational modes as a tree: each can sit under another (TRACK → Track 1,
2, 3…). Names are unique among siblings now, not across the Emitter — checked
by the app, as a parent may be none.

Revision ID: e2a4c6b8d0f1
Revises: d1f3b5a7c9e2
Create Date: 2026-11-26
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "e2a4c6b8d0f1"
down_revision = "d1f3b5a7c9e2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Null on every existing one: all at the top, as before.
    op.add_column(
        "operational_modes",
        sa.Column(
            "parent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("operational_modes.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_operational_modes_parent_id", "operational_modes", ["parent_id"])
    op.drop_constraint("uq_operational_mode_emitter_name", "operational_modes", type_="unique")


def downgrade() -> None:
    op.create_unique_constraint("uq_operational_mode_emitter_name", "operational_modes", ["emitter_id", "name"])
    op.drop_index("ix_operational_modes_parent_id", table_name="operational_modes")
    op.drop_column("operational_modes", "parent_id")
