"""add intercepts, intercept_notes, intercept_entries, intercept_entry_modes

A place to log real-world signal intercepts per Emitter, also globally
lookup-able: a container (Intercept) with its own analyst-notes feed,
holding logged observations (InterceptEntry) that can optionally be linked
to a Mode they were used to derive (InterceptEntryMode).

Revision ID: d5e6f7a8b9c0
Revises: b2c3d4e5f6a7
Create Date: 2026-09-17 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'd5e6f7a8b9c0'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'intercepts',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('emitter_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['emitter_id'], ['emitters.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_intercepts_emitter_id', 'intercepts', ['emitter_id'])

    op.create_table(
        'intercept_notes',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('intercept_id', sa.UUID(), nullable=False),
        sa.Column('author_id', sa.UUID(), nullable=True),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['intercept_id'], ['intercepts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_intercept_notes_intercept_id', 'intercept_notes', ['intercept_id'])
    op.create_index('ix_intercept_notes_created_at', 'intercept_notes', ['created_at'])

    op.create_table(
        'intercept_entries',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('intercept_id', sa.UUID(), nullable=False),
        sa.Column(
            'pri_type',
            postgresql.ENUM('fixed', 'stagger', 'cw', 'xlet', name='pritype', create_type=False),
            nullable=False,
        ),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('rf_min_mhz', sa.Numeric(14, 4), nullable=True),
        sa.Column('rf_max_mhz', sa.Numeric(14, 4), nullable=True),
        sa.Column('rf_mean_mhz', sa.Numeric(14, 4), nullable=False),
        sa.Column('pw_min_us', sa.Numeric(14, 4), nullable=True),
        sa.Column('pw_max_us', sa.Numeric(14, 4), nullable=True),
        sa.Column('pw_mean_us', sa.Numeric(14, 4), nullable=False),
        sa.Column('pri_min_us', sa.Numeric(14, 4), nullable=True),
        sa.Column('pri_max_us', sa.Numeric(14, 4), nullable=True),
        sa.Column('pri_mean_us', sa.Numeric(14, 4), nullable=False),
        sa.Column('jitter_mean_us', sa.Numeric(14, 4), nullable=True),
        sa.Column('stagger_values', postgresql.ARRAY(sa.Numeric(14, 4)), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['intercept_id'], ['intercepts.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_intercept_entries_intercept_id', 'intercept_entries', ['intercept_id'])
    op.create_index('ix_intercept_entries_created_at', 'intercept_entries', ['created_at'])

    op.create_table(
        'intercept_entry_modes',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('intercept_entry_id', sa.UUID(), nullable=False),
        sa.Column('mode_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['intercept_entry_id'], ['intercept_entries.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['mode_id'], ['modes.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_intercept_entry_modes_intercept_entry_id', 'intercept_entry_modes', ['intercept_entry_id'])
    op.create_index('ix_intercept_entry_modes_mode_id', 'intercept_entry_modes', ['mode_id'])


def downgrade() -> None:
    op.drop_index('ix_intercept_entry_modes_mode_id', table_name='intercept_entry_modes')
    op.drop_index('ix_intercept_entry_modes_intercept_entry_id', table_name='intercept_entry_modes')
    op.drop_table('intercept_entry_modes')

    op.drop_index('ix_intercept_entries_created_at', table_name='intercept_entries')
    op.drop_index('ix_intercept_entries_intercept_id', table_name='intercept_entries')
    op.drop_table('intercept_entries')

    op.drop_index('ix_intercept_notes_created_at', table_name='intercept_notes')
    op.drop_index('ix_intercept_notes_intercept_id', table_name='intercept_notes')
    op.drop_table('intercept_notes')

    op.drop_index('ix_intercepts_emitter_id', table_name='intercepts')
    op.drop_table('intercepts')
