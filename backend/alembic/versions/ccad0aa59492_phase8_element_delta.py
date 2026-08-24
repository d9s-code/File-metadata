"""phase8_element_delta

Revision ID: ccad0aa59492
Revises: ad5606655dc9
Create Date: 2026-08-24 11:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'ccad0aa59492'
down_revision: Union[str, None] = 'ad5606655dc9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('mode_elements', sa.Column('delta', sa.Numeric(precision=14, scale=4), nullable=True))
    op.add_column('ew_groups', sa.Column('scan_delta', sa.Numeric(precision=12, scale=4), nullable=True))


def downgrade() -> None:
    op.drop_column('ew_groups', 'scan_delta')
    op.drop_column('mode_elements', 'delta')
