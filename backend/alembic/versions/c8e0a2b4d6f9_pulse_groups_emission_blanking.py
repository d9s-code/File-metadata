"""Pulse groups on a Mode (N pulses, then off), an operational mode's emission
(a timeline of pulse groups and off times, and on/off periods), and a scan's
blanked sectors. Dwell planner only; not exported.

Revision ID: c8e0a2b4d6f9
Revises: b6d8f0a2c4e7
Create Date: 2026-11-27
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "c8e0a2b4d6f9"
down_revision = "b6d8f0a2c4e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Null on every existing one: sent continuously, always on, nothing blanked — as before.
    op.add_column("modes", sa.Column("group_pulses", sa.Integer, nullable=True))
    op.add_column("modes", sa.Column("group_off_ms", sa.Numeric(12, 4), nullable=True))
    op.add_column("operational_modes", sa.Column("emission", postgresql.JSONB, nullable=True))
    op.add_column("emitter_scans", sa.Column("blanked_sectors", postgresql.JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("emitter_scans", "blanked_sectors")
    op.drop_column("operational_modes", "emission")
    op.drop_column("modes", "group_off_ms")
    op.drop_column("modes", "group_pulses")
