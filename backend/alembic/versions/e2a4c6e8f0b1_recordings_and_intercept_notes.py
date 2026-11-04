"""Recordings (whole uploaded files, snipped into Intercepts) and an
Intercept's own Notes

Revision ID: e2a4c6e8f0b1
Revises: d1f3a5b7c9e2
Create Date: 2026-11-04
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "e2a4c6e8f0b1"
down_revision = "d1f3a5b7c9e2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "recordings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("sha256", sa.String(64), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="uploading"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("report_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("skipped_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("skipped_sample", postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column("first_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("uploaded_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_recordings_sha256", "recordings", ["sha256"])
    op.create_table(
        "recording_reports",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "recording_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("recordings.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("file_line", sa.Integer(), nullable=False),
        sa.Column("mission_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("track", sa.String(50), nullable=True),
        sa.Column("mode_track", sa.String(50), nullable=True),
        sa.Column("power", sa.Float(), nullable=True),
        sa.Column("designation", sa.String(200), nullable=True),
        sa.Column("mode_name", sa.String(200), nullable=True),
        sa.Column("ambiguity_count", sa.Integer(), nullable=True),
        sa.Column("pri_type", postgresql.ENUM(name="pritype", create_type=False), nullable=False),
        sa.Column("rf_mhz", sa.Float(), nullable=False),
        sa.Column("pri_us", sa.Float(), nullable=True),
        sa.Column("pw_us", sa.Float(), nullable=True),
        sa.Column("jitter_us", sa.Float(), nullable=True),
        sa.Column("stagger_us", postgresql.ARRAY(sa.Float()), nullable=True),
    )
    op.create_index("ix_recording_reports_time", "recording_reports", ["recording_id", "mission_time"])
    op.create_index("ix_recording_reports_rf", "recording_reports", ["recording_id", "rf_mhz"])
    op.add_column("intercepts", sa.Column("analysis_notes", sa.Text(), nullable=True))
    op.add_column(
        "intercepts",
        sa.Column("recording_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("recordings.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column("intercepts", sa.Column("snip", postgresql.JSONB(), nullable=True))
    op.create_index("ix_intercepts_recording_id", "intercepts", ["recording_id"])


def downgrade() -> None:
    op.drop_index("ix_intercepts_recording_id", table_name="intercepts")
    op.drop_column("intercepts", "snip")
    op.drop_column("intercepts", "recording_id")
    op.drop_column("intercepts", "analysis_notes")
    op.drop_table("recording_reports")
    op.drop_table("recordings")
