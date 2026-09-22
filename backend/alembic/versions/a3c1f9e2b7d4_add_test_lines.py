"""add test lines and test record lines

Revision ID: a3c1f9e2b7d4
Revises: f47516fcb470
Create Date: 2026-09-22 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'a3c1f9e2b7d4'
down_revision: Union[str, None] = 'f47516fcb470'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'test_lines',
        sa.Column('emitter_id', sa.UUID(), nullable=False),
        sa.Column('label', sa.Text(), nullable=False),
        sa.Column('expected_mode_id', sa.UUID(), nullable=True),
        sa.Column('expected_parameters', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('import_batch_label', sa.Text(), nullable=True),
        sa.Column('imported_by', sa.UUID(), nullable=True),
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['emitter_id'], ['emitters.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['expected_mode_id'], ['modes.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['imported_by'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_test_lines_emitter_id'), 'test_lines', ['emitter_id'], unique=False)

    op.create_table(
        'test_record_lines',
        sa.Column('test_record_id', sa.UUID(), nullable=False),
        sa.Column('test_line_id', sa.UUID(), nullable=False),
        sa.Column(
            'outcome',
            postgresql.ENUM('pass_', 'fail', 'partial', 'inconclusive', name='testresult', create_type=False),
            nullable=False,
        ),
        sa.Column('detected_as_mode_id', sa.UUID(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('id', sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(['detected_as_mode_id'], ['modes.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['test_line_id'], ['test_lines.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['test_record_id'], ['test_records.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_test_record_lines_test_line_id'), 'test_record_lines', ['test_line_id'], unique=False)
    op.create_index(op.f('ix_test_record_lines_test_record_id'), 'test_record_lines', ['test_record_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_test_record_lines_test_record_id'), table_name='test_record_lines')
    op.drop_index(op.f('ix_test_record_lines_test_line_id'), table_name='test_record_lines')
    op.drop_table('test_record_lines')
    op.drop_index(op.f('ix_test_lines_emitter_id'), table_name='test_lines')
    op.drop_table('test_lines')
