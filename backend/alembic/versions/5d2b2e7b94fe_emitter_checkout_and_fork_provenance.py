"""emitter checkout and fork provenance

Revision ID: 5d2b2e7b94fe
Revises: eb0437ec8ea8
Create Date: 2026-09-15 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '5d2b2e7b94fe'
down_revision: Union[str, None] = 'eb0437ec8ea8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('emitters', sa.Column('checked_out_by_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('emitters', sa.Column('checked_out_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('emitters', sa.Column('forked_from_emitter_id', postgresql.UUID(as_uuid=True), nullable=True))
    # Deliberately no FK on forked_from_version_id — see the column's
    # comment in app/models/emitter.py for why (a real FK here creates an
    # emitters <-> emitter_versions cycle that broke SQLAlchemy's flush
    # ordering for unrelated insert/delete pairs on the remote branch this
    # was ported from).
    op.add_column('emitters', sa.Column('forked_from_version_id', postgresql.UUID(as_uuid=True), nullable=True))

    op.create_index('ix_emitters_checked_out_by_id', 'emitters', ['checked_out_by_id'])
    op.create_index('ix_emitters_forked_from_emitter_id', 'emitters', ['forked_from_emitter_id'])
    op.create_index('ix_emitters_forked_from_version_id', 'emitters', ['forked_from_version_id'])

    op.create_foreign_key(
        'emitters_checked_out_by_id_fkey', 'emitters', 'users', ['checked_out_by_id'], ['id'], ondelete='SET NULL'
    )
    op.create_foreign_key(
        'emitters_forked_from_emitter_id_fkey',
        'emitters',
        'emitters',
        ['forked_from_emitter_id'],
        ['id'],
        ondelete='SET NULL',
    )

    # Postgres enum additions cannot run inside the same transaction as a
    # later statement that uses the new value, but each of these is its own
    # statement/transaction boundary via autocommit here, and no later
    # statement in this migration uses them — safe as written. No downgrade
    # for these: Postgres can't DROP VALUE without a full type rebuild.
    for value in ("checkout", "checkin", "discard", "revert", "fork"):
        op.execute(f"ALTER TYPE auditaction ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    op.drop_constraint('emitters_forked_from_emitter_id_fkey', 'emitters', type_='foreignkey')
    op.drop_constraint('emitters_checked_out_by_id_fkey', 'emitters', type_='foreignkey')
    op.drop_index('ix_emitters_forked_from_version_id', table_name='emitters')
    op.drop_index('ix_emitters_forked_from_emitter_id', table_name='emitters')
    op.drop_index('ix_emitters_checked_out_by_id', table_name='emitters')
    op.drop_column('emitters', 'forked_from_version_id')
    op.drop_column('emitters', 'forked_from_emitter_id')
    op.drop_column('emitters', 'checked_out_at')
    op.drop_column('emitters', 'checked_out_by_id')
