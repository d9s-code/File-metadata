"""add mdf_notes table

MDF was missing the same append-only "Analyst notes" feed Emitter/Source/
Intercept already have — only a single flat, overwritable `notes` field.

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-09-17 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'e6f7a8b9c0d1'
down_revision: Union[str, None] = 'd5e6f7a8b9c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'mdf_notes',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('mdf_id', sa.UUID(), nullable=False),
        sa.Column('author_id', sa.UUID(), nullable=True),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['mdf_id'], ['mdfs.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_mdf_notes_mdf_id', 'mdf_notes', ['mdf_id'])
    op.create_index('ix_mdf_notes_created_at', 'mdf_notes', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_mdf_notes_created_at', table_name='mdf_notes')
    op.drop_index('ix_mdf_notes_mdf_id', table_name='mdf_notes')
    op.drop_table('mdf_notes')
