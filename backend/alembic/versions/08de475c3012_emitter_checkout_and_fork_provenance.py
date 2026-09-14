"""emitter_checkout_and_fork_provenance

Adds an explicit editing lock to Emitter (checked_out_by_id/checked_out_at —
who currently holds the right to edit it, not a data copy) plus provenance
columns recording where a forked Emitter came from. Also adds the new
AuditAction values used by the checkout/revert/fork endpoints.

Revision ID: 08de475c3012
Revises: f5a6b7c8d9e0
Create Date: 2026-09-14 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '08de475c3012'
down_revision: Union[str, None] = 'f5a6b7c8d9e0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('emitters', sa.Column('checked_out_by_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index(op.f('ix_emitters_checked_out_by_id'), 'emitters', ['checked_out_by_id'], unique=False)
    op.create_foreign_key(
        'emitters_checked_out_by_id_fkey', 'emitters', 'users', ['checked_out_by_id'], ['id'], ondelete='SET NULL'
    )
    op.add_column('emitters', sa.Column('checked_out_at', sa.DateTime(timezone=True), nullable=True))

    op.add_column('emitters', sa.Column('forked_from_emitter_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index(op.f('ix_emitters_forked_from_emitter_id'), 'emitters', ['forked_from_emitter_id'], unique=False)
    op.create_foreign_key(
        'emitters_forked_from_emitter_id_fkey', 'emitters', 'emitters',
        ['forked_from_emitter_id'], ['id'], ondelete='SET NULL',
    )
    # Deliberately no ForeignKey: emitters -> emitter_versions -> emitters
    # (EmitterVersion.emitter_id points back at us) is a genuine two-table
    # cycle. A real FK constraint here was observed to disrupt SQLAlchemy's
    # flush-dependency ordering for entirely unrelated insert/delete pairs in
    # the same transaction (e.g. an audit_log insert racing a hard Emitter
    # delete) — see the matching comment on Emitter.forked_from_version_id.
    # This column is purely a display/traceability pointer for a forked
    # Emitter; a dangling value is harmless.
    op.add_column('emitters', sa.Column('forked_from_version_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index(op.f('ix_emitters_forked_from_version_id'), 'emitters', ['forked_from_version_id'], unique=False)

    # Postgres 12+ allows ADD VALUE inside a transaction as long as the new
    # value isn't used in that same transaction — true here, this migration
    # only adds them. Same pattern as c2d3e4f5a6b7_audit_action_restore.py.
    op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'checkout'")
    op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'checkin'")
    op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'discard'")
    op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'revert'")
    op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'fork'")


def downgrade() -> None:
    # Postgres has no DROP VALUE for enum types; removing the 5 values added
    # above would require rebuilding the type. Left as a no-op, matching
    # c2d3e4f5a6b7_audit_action_restore.py's own downgrade.

    op.drop_index(op.f('ix_emitters_forked_from_version_id'), table_name='emitters')
    op.drop_column('emitters', 'forked_from_version_id')

    op.drop_constraint('emitters_forked_from_emitter_id_fkey', 'emitters', type_='foreignkey')
    op.drop_index(op.f('ix_emitters_forked_from_emitter_id'), table_name='emitters')
    op.drop_column('emitters', 'forked_from_emitter_id')

    op.drop_column('emitters', 'checked_out_at')
    op.drop_constraint('emitters_checked_out_by_id_fkey', 'emitters', type_='foreignkey')
    op.drop_index(op.f('ix_emitters_checked_out_by_id'), table_name='emitters')
    op.drop_column('emitters', 'checked_out_by_id')
