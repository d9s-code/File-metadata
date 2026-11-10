"""A Platform's hostility and base, as the PRS XML writes them

The allegiance becomes the hostility, in the XML's own words — UNKNOWN,
FRIEND, HOSTILE, NEUTRAL (unset was unknown) — and a base is added: SEA,
GROUND, SUBSURFACE, UNKNOWN or AIR. Both always set, UNKNOWN to start.

Revision ID: c8e0a2b4d6f7
Revises: b6d8f0a2c4e5
"""

import sqlalchemy as sa

from alembic import op

revision = "c8e0a2b4d6f7"
down_revision = "b6d8f0a2c4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_platforms_allegiance", "platforms", type_="check")
    op.alter_column("platforms", "allegiance", new_column_name="hostility")
    op.execute(
        "UPDATE platforms SET hostility = CASE hostility "
        "WHEN 'hostile' THEN 'HOSTILE' WHEN 'neutral' THEN 'NEUTRAL' WHEN 'friendly' THEN 'FRIEND' ELSE 'UNKNOWN' END"
    )
    op.alter_column("platforms", "hostility", nullable=False, server_default="UNKNOWN")
    op.create_check_constraint(
        "ck_platforms_hostility", "platforms", "hostility IN ('UNKNOWN', 'FRIEND', 'HOSTILE', 'NEUTRAL')"
    )
    op.add_column("platforms", sa.Column("base", sa.String(16), nullable=False, server_default="UNKNOWN"))
    op.create_check_constraint(
        "ck_platforms_base", "platforms", "base IN ('SEA', 'GROUND', 'SUBSURFACE', 'UNKNOWN', 'AIR')"
    )


def downgrade() -> None:
    op.drop_constraint("ck_platforms_base", "platforms", type_="check")
    op.drop_column("platforms", "base")
    op.drop_constraint("ck_platforms_hostility", "platforms", type_="check")
    op.alter_column("platforms", "hostility", nullable=True, server_default=None)
    op.execute(
        "UPDATE platforms SET hostility = CASE hostility "
        "WHEN 'HOSTILE' THEN 'hostile' WHEN 'NEUTRAL' THEN 'neutral' WHEN 'FRIEND' THEN 'friendly' ELSE NULL END"
    )
    op.alter_column("platforms", "hostility", new_column_name="allegiance")
    op.create_check_constraint(
        "ck_platforms_allegiance", "platforms", "allegiance IN ('hostile', 'neutral', 'friendly')"
    )
