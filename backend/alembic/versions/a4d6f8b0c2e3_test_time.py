"""When on its date a test ran

Optional; shown with the date on the simulation trend. Runs logged before
it have none.

Revision ID: a4d6f8b0c2e3
Revises: f3c5e7a9b1d2
Create Date: 2026-10-08

"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "a4d6f8b0c2e3"
down_revision: Union[str, None] = "f3c5e7a9b1d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("test_records", sa.Column("test_time", sa.Time(), nullable=True))


def downgrade() -> None:
    op.drop_column("test_records", "test_time")
