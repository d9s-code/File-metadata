"""remove_mode_draft_workflow

Removes the Mode-level propose/approve micro-workflow added in
472c241a83c4_mode_drafts_and_test_derivation.py (this migration is its
mirror image in reverse). Line edits are now instant like any other Mode
edit, gated only by the Emitter-level checkout lock added in
08de475c3012_emitter_checkout_and_fork_provenance.py.

Any Mode row not already 'approved' has no home once the status column is
gone: a pending 'draft' was never vetted, and a 'superseded'/'rejected' row
is retired history nobody reads (excluded from every active view already).
Deleting them here is consistent with delete_mode's own existing
zero-safety-check cascade to test_record_modes (mode_id ON DELETE CASCADE)
— this migration introduces no new class of data loss, and the destination
database has zero such rows as of this writing.

Revision ID: d6c8b50650d6
Revises: 08de475c3012
Create Date: 2026-09-14 12:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd6c8b50650d6'
down_revision: Union[str, None] = '08de475c3012'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


mode_status_enum = sa.Enum('approved', 'draft', 'superseded', 'rejected', name='modestatus')


def upgrade() -> None:
    op.execute("DELETE FROM modes WHERE status != 'approved'")
    op.drop_constraint('modes_supersedes_id_fkey', 'modes', type_='foreignkey')
    op.drop_index(op.f('ix_modes_supersedes_id'), table_name='modes')
    op.drop_column('modes', 'supersedes_id')
    op.drop_column('modes', 'status')
    bind = op.get_bind()
    mode_status_enum.drop(bind, checkfirst=True)


def downgrade() -> None:
    # Cannot restore deleted rows — same irreversibility already accepted by
    # 472c241a83c4's own forward migration for its enum/column adds.
    bind = op.get_bind()
    mode_status_enum.create(bind, checkfirst=True)
    op.add_column('modes', sa.Column('status', mode_status_enum, server_default='approved', nullable=False))
    op.add_column('modes', sa.Column('supersedes_id', sa.UUID(), nullable=True))
    op.create_index(op.f('ix_modes_supersedes_id'), 'modes', ['supersedes_id'], unique=False)
    op.create_foreign_key(
        'modes_supersedes_id_fkey', 'modes', 'modes', ['supersedes_id'], ['id'], ondelete='SET NULL'
    )
