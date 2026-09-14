"""dummy migration to restore missing revision

Revision ID: e4f5a6b7c8d9
Revises: None
Create Date: 2026-09-09 09:30:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'e4f5a6b7c8d9'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
