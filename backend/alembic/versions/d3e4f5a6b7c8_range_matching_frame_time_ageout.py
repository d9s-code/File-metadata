"""range_matching_frame_time_ageout

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-08-31 00:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd3e4f5a6b7c8'
down_revision: Union[str, None] = 'c2d3e4f5a6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('modes', sa.Column('range_matching', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.alter_column('modes', 'range_matching', server_default=None)

    op.add_column('mode_lines', sa.Column('frame_time_delta_us', sa.Numeric(14, 4), nullable=True))
    op.add_column('ew_groups', sa.Column('ageout', sa.Numeric(12, 4), nullable=True))

    # Pre-existing stagger PRI elements predate the new "delta required for
    # stagger" rule — backfill 0 (a no-op tolerance) so they stay valid.
    op.execute(
        "UPDATE mode_elements SET delta = 0 "
        "WHERE element_type = 'pri' AND stagger_values IS NOT NULL AND delta IS NULL"
    )


def downgrade() -> None:
    op.drop_column('ew_groups', 'ageout')
    op.drop_column('mode_lines', 'frame_time_delta_us')
    op.drop_column('modes', 'range_matching')
