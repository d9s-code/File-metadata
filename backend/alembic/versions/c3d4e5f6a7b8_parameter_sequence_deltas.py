"""add rf/pw/pri delta to parameter_sequences

Adds the tolerance-margin columns Cartesian Product applies to whichever of
a selected step's rf_mhz/pw_us/pri_us gets used — same raw-vs-engineered
pattern as ModeElement.delta, now available on ParameterSequence too.

Revision ID: c3d4e5f6a7b8
Revises: 9621f10ca8cd
Create Date: 2026-09-16 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, None] = '9621f10ca8cd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('parameter_sequences', sa.Column('rf_delta', sa.Numeric(14, 4), nullable=True))
    op.add_column('parameter_sequences', sa.Column('pw_delta', sa.Numeric(14, 4), nullable=True))
    op.add_column('parameter_sequences', sa.Column('pri_delta', sa.Numeric(14, 4), nullable=True))


def downgrade() -> None:
    op.drop_column('parameter_sequences', 'pri_delta')
    op.drop_column('parameter_sequences', 'pw_delta')
    op.drop_column('parameter_sequences', 'rf_delta')
