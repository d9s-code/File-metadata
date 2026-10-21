"""A test run's Received Power (dBFS)

How strong the signals were received over a whole run, in dBFS — asked of
every run logged from now on (on a Platform test, and each Emitter's
record of it). Runs logged before have none.

Revision ID: f3b5d7e9a1c2
Revises: e7a9c1b3d5f6
Create Date: 2026-10-21

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f3b5d7e9a1c2"
down_revision: Union[str, None] = "e7a9c1b3d5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("test_records", sa.Column("received_power_dbfs", sa.Numeric(10, 3), nullable=True))
    op.add_column("platform_tests", sa.Column("received_power_dbfs", sa.Numeric(10, 3), nullable=True))


def downgrade() -> None:
    op.drop_column("platform_tests", "received_power_dbfs")
    op.drop_column("test_records", "received_power_dbfs")
