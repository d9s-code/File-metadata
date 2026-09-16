"""remove mode draft workflow

Removes the Mode-level propose/approve/reject micro-workflow (ModeStatus,
Mode.supersedes_id), replaced by an Emitter-level checkout lock with instant
Mode-line edits (see the prior migration, 5d2b2e7b94fe).

Revision ID: a867083eef27
Revises: 5d2b2e7b94fe
Create Date: 2026-09-15 00:00:01.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'a867083eef27'
down_revision: Union[str, None] = '5d2b2e7b94fe'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Any actual pending draft (status != 'approved') is deleted here —
    # there is no draft/approve concept left for it to belong to. Confirmed
    # zero such rows in this database before writing this migration; if you
    # are running this against a database with real drafts, back them up
    # first (this step is irreversible).
    op.execute("DELETE FROM modes WHERE status != 'approved'")

    op.drop_constraint('modes_supersedes_id_fkey', 'modes', type_='foreignkey')
    op.drop_index('ix_modes_supersedes_id', table_name='modes')
    op.drop_column('modes', 'supersedes_id')
    op.drop_column('modes', 'status')
    op.execute("DROP TYPE IF EXISTS modestatus")


def downgrade() -> None:
    modestatus = postgresql.ENUM('approved', 'draft', 'superseded', 'rejected', name='modestatus')
    modestatus.create(op.get_bind(), checkfirst=True)
    op.add_column(
        'modes',
        sa.Column('status', modestatus, nullable=False, server_default='approved'),
    )
    op.add_column('modes', sa.Column('supersedes_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index('ix_modes_supersedes_id', 'modes', ['supersedes_id'])
    op.create_foreign_key(
        'modes_supersedes_id_fkey', 'modes', 'modes', ['supersedes_id'], ['id'], ondelete='SET NULL'
    )
    # Deleted rows from upgrade() are not recoverable — same accepted,
    # irreversible precedent as the migration that originally added this
    # workflow.
