"""Function codes: what kind of emitter an Emitter is

An Admin-kept list (code, name, description, order); each Emitter points at
one. Used to group the threat priority overview; not versioned, not exported.

Revision ID: b6d8f0a2c4e5
Revises: a4c6e8f0b2d3
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "b6d8f0a2c4e5"
down_revision = "a4c6e8f0b2d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "function_codes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(32), nullable=False, unique=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.add_column(
        "emitters",
        sa.Column(
            "function_code_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("function_codes.id", ondelete="RESTRICT"),
            nullable=True,
        ),
    )
    op.create_index("ix_emitters_function_code_id", "emitters", ["function_code_id"])


def downgrade() -> None:
    op.drop_index("ix_emitters_function_code_id", table_name="emitters")
    op.drop_column("emitters", "function_code_id")
    op.drop_table("function_codes")
