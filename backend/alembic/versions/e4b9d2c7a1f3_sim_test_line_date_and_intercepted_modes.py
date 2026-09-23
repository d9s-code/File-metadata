"""SIM test line created date; intercepted modes and params per test line result

Revision ID: e4b9d2c7a1f3
Revises: c3a8e5f1b2d6
Create Date: 2026-09-23 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'e4b9d2c7a1f3'
down_revision: Union[str, None] = 'c3a8e5f1b2d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('test_lines', sa.Column('created_date', sa.Date(), nullable=True))
    op.add_column('test_record_lines', sa.Column('observed_values', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.create_table(
        'test_record_line_modes',
        sa.Column('test_record_line_id', sa.UUID(), nullable=False),
        sa.Column('mode_id', sa.UUID(), nullable=False),
        sa.Column('id', sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(['mode_id'], ['modes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['test_record_line_id'], ['test_record_lines.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('test_record_line_id', 'mode_id', name='uq_test_record_line_mode'),
    )
    op.create_index(op.f('ix_test_record_line_modes_mode_id'), 'test_record_line_modes', ['mode_id'], unique=False)
    op.create_index(
        op.f('ix_test_record_line_modes_test_record_line_id'), 'test_record_line_modes', ['test_record_line_id'], unique=False
    )
    # The single "detected as" Mode becomes the first entry in the new list.
    op.execute(
        """
        INSERT INTO test_record_line_modes (id, test_record_line_id, mode_id)
        SELECT gen_random_uuid(), id, detected_as_mode_id
        FROM test_record_lines
        WHERE detected_as_mode_id IS NOT NULL
        """
    )
    op.drop_column('test_record_lines', 'detected_as_mode_id')


def downgrade() -> None:
    op.add_column(
        'test_record_lines',
        sa.Column('detected_as_mode_id', sa.UUID(), sa.ForeignKey('modes.id', ondelete='SET NULL'), nullable=True),
    )
    # Only one Mode fits back into the old column; keep an arbitrary one.
    op.execute(
        """
        UPDATE test_record_lines AS trl
        SET detected_as_mode_id = picked.mode_id
        FROM (
            SELECT DISTINCT ON (test_record_line_id) test_record_line_id, mode_id
            FROM test_record_line_modes
            ORDER BY test_record_line_id, mode_id
        ) AS picked
        WHERE trl.id = picked.test_record_line_id
        """
    )
    op.drop_index(op.f('ix_test_record_line_modes_test_record_line_id'), table_name='test_record_line_modes')
    op.drop_index(op.f('ix_test_record_line_modes_mode_id'), table_name='test_record_line_modes')
    op.drop_table('test_record_line_modes')
    op.drop_column('test_record_lines', 'observed_values')
    op.drop_column('test_lines', 'created_date')
