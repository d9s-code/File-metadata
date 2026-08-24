"""phase9_generation_batches

Revision ID: a1791090b6a3
Revises: ccad0aa59492
Create Date: 2026-08-24 20:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a1791090b6a3'
down_revision: Union[str, None] = 'ccad0aa59492'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'mode_generation_batches',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('ew_group_id', sa.UUID(), nullable=False),
        sa.Column('source_id', sa.UUID(), nullable=False),
        sa.Column('name_prefix', sa.String(length=200), nullable=False),
        sa.Column('created_by', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        sa.ForeignKeyConstraint(['ew_group_id'], ['ew_groups.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['source_id'], ['sources.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_mode_generation_batches_ew_group_id'), 'mode_generation_batches', ['ew_group_id'], unique=False
    )
    op.create_index(
        op.f('ix_mode_generation_batches_source_id'), 'mode_generation_batches', ['source_id'], unique=False
    )

    op.add_column('modes', sa.Column('generation_batch_id', sa.UUID(), nullable=True))
    op.create_index(op.f('ix_modes_generation_batch_id'), 'modes', ['generation_batch_id'], unique=False)
    op.create_foreign_key(
        'fk_modes_generation_batch_id',
        'modes',
        'mode_generation_batches',
        ['generation_batch_id'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('fk_modes_generation_batch_id', 'modes', type_='foreignkey')
    op.drop_index(op.f('ix_modes_generation_batch_id'), table_name='modes')
    op.drop_column('modes', 'generation_batch_id')

    op.drop_index(op.f('ix_mode_generation_batches_source_id'), table_name='mode_generation_batches')
    op.drop_index(op.f('ix_mode_generation_batches_ew_group_id'), table_name='mode_generation_batches')
    op.drop_table('mode_generation_batches')
