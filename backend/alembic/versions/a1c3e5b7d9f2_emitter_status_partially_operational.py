"""Emitter status: Partially operational

Revision ID: a1c3e5b7d9f2
Revises: f7b9d1c3e5a6
Create Date: 2026-10-16

"""

from typing import Sequence, Union

from alembic import op

revision: str = "a1c3e5b7d9f2"
down_revision: Union[str, None] = "f7b9d1c3e5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Between Testing and Operational in severity order.
    op.execute("ALTER TYPE emitterstatus ADD VALUE IF NOT EXISTS 'partially_operational' BEFORE 'validated'")


def downgrade() -> None:
    # Postgres can't drop an enum value: move those Emitters back to Testing,
    # then rebuild the type without it.
    op.execute("UPDATE emitters SET status = 'in_review' WHERE status = 'partially_operational'")
    op.execute("ALTER TYPE emitterstatus RENAME TO emitterstatus_old")
    op.execute("CREATE TYPE emitterstatus AS ENUM ('draft', 'in_review', 'validated', 'deprecated')")
    op.execute("ALTER TABLE emitters ALTER COLUMN status TYPE emitterstatus USING status::text::emitterstatus")
    op.execute("DROP TYPE emitterstatus_old")
