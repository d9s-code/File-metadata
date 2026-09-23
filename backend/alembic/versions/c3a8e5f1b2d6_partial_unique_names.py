"""unique names among non-deleted emitters, platforms and mdfs

Revision ID: c3a8e5f1b2d6
Revises: b7e2c4a9d1f0
Create Date: 2026-09-23 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c3a8e5f1b2d6'
down_revision: Union[str, None] = 'b7e2c4a9d1f0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("emitters", "platforms", "mdfs")


def upgrade() -> None:
    for table in _TABLES:
        op.drop_index(f"ix_{table}_name", table_name=table)
        op.create_index(f"ix_{table}_name", table, ["name"], unique=False)
        op.create_index(
            f"uq_{table}_name_active", table, ["name"], unique=True, postgresql_where=sa.text("NOT is_deleted")
        )


def downgrade() -> None:
    # Fails if a live row and a soft-deleted row now share a name.
    for table in _TABLES:
        op.drop_index(f"uq_{table}_name_active", table_name=table)
        op.drop_index(f"ix_{table}_name", table_name=table)
        op.create_index(f"ix_{table}_name", table, ["name"], unique=True)
