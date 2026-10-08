"""A test run's result can be overridden

`computed_result` keeps what the result worked out to (worst of the lines or
Modes) when someone overrides it, and `result_note` why. Both null when the
result is the worked-out one.

Revision ID: b6e8f0a2c4d5
Revises: a4d6f8b0c2e3
Create Date: 2026-10-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "b6e8f0a2c4d5"
down_revision: Union[str, None] = "a4d6f8b0c2e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    testresult = postgresql.ENUM(name="testresult", create_type=False)
    op.add_column("test_records", sa.Column("computed_result", testresult, nullable=True))
    op.add_column("test_records", sa.Column("result_note", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("test_records", "result_note")
    op.drop_column("test_records", "computed_result")
