"""Platform and MDF tests: what was observed, Emitter by Emitter

Which Emitters were on the air, whether each was detected (how soon, by
which dwell), and what it was reported as — itself, Default Unknown, or
other Emitters (mix-ups, optionally Mode for Mode); and, in an MDF test,
which Platform each presented Platform was intercepted as. New tables only.

Revision ID: a7c9e1b3d5f7
Revises: f4b6d8a0c2e3
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "a7c9e1b3d5f7"
down_revision = "f4b6d8a0c2e3"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "scenario_emitters",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("platform_test_id", UUID, sa.ForeignKey("platform_tests.id", ondelete="CASCADE"), nullable=True),
        sa.Column("mdf_test_record_id", UUID, sa.ForeignKey("test_records.id", ondelete="CASCADE"), nullable=True),
        sa.Column("platform_id", UUID, nullable=True),
        sa.Column("platform_name", sa.Text(), nullable=True),
        sa.Column("emitter_id", UUID, nullable=False),
        sa.Column("emitter_name", sa.Text(), nullable=False),
        sa.Column("detected", sa.Boolean(), nullable=True),
        sa.Column("time_to_detect_s", sa.Numeric(12, 3), nullable=True),
        sa.Column("dwell_index", sa.Integer(), nullable=True),
        sa.Column("dwell_label", sa.String(200), nullable=True),
        sa.Column("reported_self", sa.Boolean(), nullable=True),
        sa.Column("reported_unknown", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("result", sa.String(20), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("num_nonnulls(platform_test_id, mdf_test_record_id) = 1", name="ck_scenario_emitters_one_test"),
        sa.CheckConstraint("time_to_detect_s IS NULL OR time_to_detect_s >= 0", name="ck_scenario_emitters_time"),
    )
    op.create_index("ix_scenario_emitters_platform_test_id", "scenario_emitters", ["platform_test_id"])
    op.create_index("ix_scenario_emitters_mdf_test_record_id", "scenario_emitters", ["mdf_test_record_id"])
    op.create_table(
        "scenario_reports",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("scenario_emitter_id", UUID, sa.ForeignKey("scenario_emitters.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reported_emitter_id", UUID, nullable=False),
        sa.Column("reported_emitter_name", sa.Text(), nullable=False),
        sa.Column("reported_platform_id", UUID, nullable=True),
        sa.Column("reported_platform_name", sa.Text(), nullable=True),
        sa.Column("expected_mode", sa.String(200), nullable=True),
        sa.Column("reported_mode", sa.String(200), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_scenario_reports_scenario_emitter_id", "scenario_reports", ["scenario_emitter_id"])
    op.create_table(
        "mdf_test_platforms",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("mdf_test_record_id", UUID, sa.ForeignKey("test_records.id", ondelete="CASCADE"), nullable=False),
        sa.Column("platform_id", UUID, nullable=False),
        sa.Column("platform_name", sa.Text(), nullable=False),
        sa.Column("intercepted_as_platform_id", UUID, nullable=True),
        sa.Column("intercepted_as_name", sa.Text(), nullable=True),
        sa.Column("intercepted_unknown", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_mdf_test_platforms_mdf_test_record_id", "mdf_test_platforms", ["mdf_test_record_id"])


def downgrade() -> None:
    op.drop_index("ix_mdf_test_platforms_mdf_test_record_id", table_name="mdf_test_platforms")
    op.drop_table("mdf_test_platforms")
    op.drop_index("ix_scenario_reports_scenario_emitter_id", table_name="scenario_reports")
    op.drop_table("scenario_reports")
    op.drop_index("ix_scenario_emitters_mdf_test_record_id", table_name="scenario_emitters")
    op.drop_index("ix_scenario_emitters_platform_test_id", table_name="scenario_emitters")
    op.drop_table("scenario_emitters")
