"""update source columns

Revision ID: update_source_cols_rev
Revises: final_fix_all_rev
Create Date: 2026-09-11 08:46:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'update_source_cols_rev'
down_revision = '21501ac80f20'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Rename description to rf_legacy_term
    op.alter_column('sources', 'description', new_column_name='rf_legacy_term')
    
    # 2. Add pri_legacy_term
    op.add_column('sources', sa.Column('pri_legacy_term', sa.Text(), nullable=True))
    
    # 3. Add source_last_updated
    op.add_column('sources', sa.Column('source_last_updated', sa.Date(), nullable=True))


def downgrade() -> None:
    # 1. Remove newly added columns
    op.drop_column('sources', 'source_last_updated')
    op.drop_column('sources', 'pri_legacy_term')
    
    # 2. Rename rf_legacy_term back to description
    op.alter_column('sources', 'rf_legacy_term', new_column_name='description')
