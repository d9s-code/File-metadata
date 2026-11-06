"""An MDF can start from a saved version of another MDF

"New MDF from this one" makes a separate MDF (for another customer, say)
with the source version's Platform pins and dwell files; it remembers which
MDF and version it was based on.

Revision ID: d2f4a6c8e0b1
Revises: c5e7a9b1d3f4
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "d2f4a6c8e0b1"
down_revision = "c5e7a9b1d3f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "mdfs",
        sa.Column(
            "based_on_mdf_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("mdfs.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_mdfs_based_on_mdf_id", "mdfs", ["based_on_mdf_id"])
    op.add_column("mdfs", sa.Column("based_on_version_number", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("mdfs", "based_on_version_number")
    op.drop_index("ix_mdfs_based_on_mdf_id", table_name="mdfs")
    op.drop_column("mdfs", "based_on_mdf_id")
