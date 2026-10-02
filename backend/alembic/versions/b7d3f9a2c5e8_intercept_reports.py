"""Intercept reports

The reports an Intercept's entries were grouped from, kept so they can be
viewed and regrouped after the import. Each links to the entry it went into,
or to none (left out of the import). intercepts.grouping_version counts
changes to which report is in which entry, so two people regrouping the same
Intercept can't silently overwrite each other.

Revision ID: b7d3f9a2c5e8
Revises: a6c2e8f4d1b9
Create Date: 2026-10-02

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "b7d3f9a2c5e8"
down_revision: Union[str, None] = "a6c2e8f4d1b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "intercepts", sa.Column("grouping_version", sa.Integer(), nullable=False, server_default="0")
    )
    op.create_table(
        "intercept_reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "intercept_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("intercepts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "entry_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("intercept_entries.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("source_file", sa.String(255), nullable=True),
        sa.Column("file_line", sa.Integer(), nullable=False),
        sa.Column("mission_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("track", sa.String(50), nullable=True),
        sa.Column("mode_track", sa.String(50), nullable=True),
        sa.Column("power", sa.Numeric(14, 4), nullable=True),
        sa.Column("designation", sa.String(200), nullable=True),
        sa.Column("mode_name", sa.String(200), nullable=True),
        sa.Column("ambiguity_count", sa.Integer(), nullable=True),
        sa.Column("pri_type", postgresql.ENUM(name="pritype", create_type=False), nullable=False),
        sa.Column("rf_mhz", sa.Numeric(14, 4), nullable=False),
        sa.Column("pri_us", sa.Numeric(14, 4), nullable=True),
        sa.Column("pw_us", sa.Numeric(14, 4), nullable=True),
        sa.Column("jitter_us", sa.Numeric(14, 4), nullable=True),
        sa.Column("stagger_us", postgresql.ARRAY(sa.Numeric(14, 4)), nullable=True),
    )
    op.create_index("ix_intercept_reports_intercept_id", "intercept_reports", ["intercept_id"])
    op.create_index("ix_intercept_reports_entry_id", "intercept_reports", ["entry_id"])


def downgrade() -> None:
    op.drop_index("ix_intercept_reports_entry_id", table_name="intercept_reports")
    op.drop_index("ix_intercept_reports_intercept_id", table_name="intercept_reports")
    op.drop_table("intercept_reports")
    op.drop_column("intercepts", "grouping_version")
