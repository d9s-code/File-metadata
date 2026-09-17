"""add customers table and mdf notes/release_date/customer_id

Who an MDF is delivered to (Customer, a small structured entity so sorting
by customer doesn't drift on inconsistent spelling), plus a plain notes
field and a release date — none of this existed on MDF before.

Revision ID: a1b2c3d4e5f6
Revises: f1a2b3c4d5e6
Create Date: 2026-09-17 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'customers',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name'),
    )

    op.add_column('mdfs', sa.Column('notes', sa.Text(), nullable=True))
    op.add_column('mdfs', sa.Column('release_date', sa.Date(), nullable=True))
    op.add_column('mdfs', sa.Column('customer_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'fk_mdfs_customer_id', 'mdfs', 'customers', ['customer_id'], ['id'], ondelete='SET NULL'
    )
    op.create_index('ix_mdfs_customer_id', 'mdfs', ['customer_id'])


def downgrade() -> None:
    op.drop_index('ix_mdfs_customer_id', table_name='mdfs')
    op.drop_constraint('fk_mdfs_customer_id', 'mdfs', type_='foreignkey')
    op.drop_column('mdfs', 'customer_id')
    op.drop_column('mdfs', 'release_date')
    op.drop_column('mdfs', 'notes')

    op.drop_table('customers')
