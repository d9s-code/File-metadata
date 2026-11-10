"""A Platform's allegiance and speed

Hostile, neutral or friendly (unset: unknown), and a speed range in km/h or
knots — both written to the Platform's PRS XML (Hostility, Speed).

Revision ID: a4c6e8f0b2d3
Revises: e3b5d7f9a1c2
"""

import sqlalchemy as sa

from alembic import op

revision = "a4c6e8f0b2d3"
down_revision = "e3b5d7f9a1c2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("platforms", sa.Column("allegiance", sa.String(16), nullable=True))
    op.add_column("platforms", sa.Column("speed_min", sa.Numeric(10, 2), nullable=True))
    op.add_column("platforms", sa.Column("speed_max", sa.Numeric(10, 2), nullable=True))
    op.add_column("platforms", sa.Column("speed_unit", sa.String(8), nullable=False, server_default="kmh"))
    op.create_check_constraint(
        "ck_platforms_allegiance", "platforms", "allegiance IN ('hostile', 'neutral', 'friendly')"
    )
    op.create_check_constraint("ck_platforms_speed_unit", "platforms", "speed_unit IN ('kmh', 'knots')")


def downgrade() -> None:
    op.drop_constraint("ck_platforms_speed_unit", "platforms", type_="check")
    op.drop_constraint("ck_platforms_allegiance", "platforms", type_="check")
    op.drop_column("platforms", "speed_unit")
    op.drop_column("platforms", "speed_max")
    op.drop_column("platforms", "speed_min")
    op.drop_column("platforms", "allegiance")
