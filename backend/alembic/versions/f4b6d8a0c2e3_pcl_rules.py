"""Platform confidence rules (experimental)

A condition on what's heard that gives a confidence level, 1 to 3, that it's
a given Platform. Kept apart from the Platform's versions while experimental.

Revision ID: f4b6d8a0c2e3
Revises: d0f2b4c6e8a1
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "f4b6d8a0c2e3"
down_revision = "d0f2b4c6e8a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pcl_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("platform_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("platforms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False),
        sa.Column("condition", postgresql.JSONB(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("level BETWEEN 1 AND 3", name="ck_pcl_rules_level"),
    )
    op.create_index("ix_pcl_rules_platform_id", "pcl_rules", ["platform_id"])


def downgrade() -> None:
    op.drop_index("ix_pcl_rules_platform_id", table_name="pcl_rules")
    op.drop_table("pcl_rules")
