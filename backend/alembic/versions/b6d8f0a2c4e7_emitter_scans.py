"""An Emitter's scans (circular, sector, raster, ESA dwells…), each with
what's needed to work out its illumination time and revisit. Operational
modes and Modes point to one instead of a scan period min–max (and an
operational mode's own illumination time). Dwell planner only; not exported.

The old operational-mode scan/illumination values and Mode scan boxes are
dropped: they were planner-only and not yet in use.

Revision ID: b6d8f0a2c4e7
Revises: a4c6e8f0b2d5
Create Date: 2026-11-27
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "b6d8f0a2c4e7"
down_revision = "a4c6e8f0b2d5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "emitter_scans",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "emitter_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("emitters.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("pattern", sa.String(30), nullable=False),
        sa.Column("params", postgresql.JSONB, nullable=True),
        sa.Column("beam_az_deg", sa.Numeric(10, 4), nullable=True),
        sa.Column("beam_el_deg", sa.Numeric(10, 4), nullable=True),
        sa.Column("illumination_ms", sa.Numeric(12, 4), nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_emitter_scans_emitter_id", "emitter_scans", ["emitter_id"])
    for table in ("operational_modes", "modes"):
        op.add_column(
            table,
            sa.Column(
                "scan_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("emitter_scans.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        op.create_index(f"ix_{table}_scan_id", table, ["scan_id"])
    op.drop_column("operational_modes", "illumination_time_ms")
    op.drop_column("operational_modes", "scan_min_s")
    op.drop_column("operational_modes", "scan_max_s")
    op.drop_column("modes", "scan_min_s")
    op.drop_column("modes", "scan_max_s")


def downgrade() -> None:
    op.add_column("modes", sa.Column("scan_max_s", sa.Numeric(12, 4), nullable=True))
    op.add_column("modes", sa.Column("scan_min_s", sa.Numeric(12, 4), nullable=True))
    op.add_column("operational_modes", sa.Column("scan_max_s", sa.Numeric(12, 4), nullable=True))
    op.add_column("operational_modes", sa.Column("scan_min_s", sa.Numeric(12, 4), nullable=True))
    op.add_column("operational_modes", sa.Column("illumination_time_ms", sa.Numeric(12, 4), nullable=True))
    for table in ("operational_modes", "modes"):
        op.drop_index(f"ix_{table}_scan_id", table_name=table)
        op.drop_column(table, "scan_id")
    op.drop_index("ix_emitter_scans_emitter_id", table_name="emitter_scans")
    op.drop_table("emitter_scans")
