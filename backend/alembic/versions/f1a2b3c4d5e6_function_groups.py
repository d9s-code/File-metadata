"""add function_groups + test_record_function_groups tables, modes.function_group_id

Function Group is a new, independent per-Emitter grouping of Modes (parallel
to EW Group, not a replacement) used to organize testing around what a Mode
does rather than its scan/threat parameters. test_record_function_groups
records each represented Function Group's outcome for a specific test —
a computed worst-of-N aggregate plus an optional manual override.

Revision ID: f1a2b3c4d5e6
Revises: d4e5f6a7b8c9
Create Date: 2026-09-16 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'function_groups',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('emitter_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['emitter_id'], ['emitters.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_function_groups_emitter_id', 'function_groups', ['emitter_id'])

    op.add_column('modes', sa.Column('function_group_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'fk_modes_function_group_id', 'modes', 'function_groups', ['function_group_id'], ['id'], ondelete='SET NULL'
    )
    op.create_index('ix_modes_function_group_id', 'modes', ['function_group_id'])

    op.create_table(
        'test_record_function_groups',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('test_record_id', sa.UUID(), nullable=False),
        sa.Column('function_group_id', sa.UUID(), nullable=False),
        sa.Column(
            'computed_result',
            postgresql.ENUM('pass', 'fail', 'partial', 'inconclusive', name='testresult', create_type=False),
            nullable=False,
        ),
        sa.Column(
            'override_result',
            postgresql.ENUM('pass', 'fail', 'partial', 'inconclusive', name='testresult', create_type=False),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(['test_record_id'], ['test_records.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['function_group_id'], ['function_groups.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_test_record_function_groups_test_record_id', 'test_record_function_groups', ['test_record_id'])
    op.create_index('ix_test_record_function_groups_function_group_id', 'test_record_function_groups', ['function_group_id'])


def downgrade() -> None:
    op.drop_index('ix_test_record_function_groups_function_group_id', table_name='test_record_function_groups')
    op.drop_index('ix_test_record_function_groups_test_record_id', table_name='test_record_function_groups')
    op.drop_table('test_record_function_groups')

    op.drop_index('ix_modes_function_group_id', table_name='modes')
    op.drop_constraint('fk_modes_function_group_id', 'modes', type_='foreignkey')
    op.drop_column('modes', 'function_group_id')

    op.drop_index('ix_function_groups_emitter_id', table_name='function_groups')
    op.drop_table('function_groups')
