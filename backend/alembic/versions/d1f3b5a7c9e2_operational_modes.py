"""A radar's operational modes, and each Mode's link to the one it's
transmitted in — its illumination time comes from there (dwell planner).

Revision ID: d1f3b5a7c9e2
Revises: c9e1a3b5d7f9
Create Date: 2026-11-26
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "d1f3b5a7c9e2"
down_revision = "c9e1a3b5d7f9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "operational_modes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("emitter_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("emitters.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("illumination_time_ms", sa.Numeric(12, 4), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("emitter_id", "name", name="uq_operational_mode_emitter_name"),
    )
    op.create_index("ix_operational_modes_emitter_id", "operational_modes", ["emitter_id"])
    # Null on every existing Mode: linked to none, so nothing it does changes.
    op.add_column(
        "modes",
        sa.Column(
            "operational_mode_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("operational_modes.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_modes_operational_mode_id", "modes", ["operational_mode_id"])


def downgrade() -> None:
    op.drop_index("ix_modes_operational_mode_id", table_name="modes")
    op.drop_column("modes", "operational_mode_id")
    op.drop_index("ix_operational_modes_emitter_id", table_name="operational_modes")
    op.drop_table("operational_modes")
