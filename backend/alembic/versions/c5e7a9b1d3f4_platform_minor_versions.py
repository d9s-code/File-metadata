"""Platform versions get a major.minor label

Save version makes the next whole version (v4); repinning an Emitter that's
in the saved version saves a minor one (v3.1). version_number stays the
order they were saved in. Existing versions are whole versions.

Revision ID: c5e7a9b1d3f4
Revises: b4d6f8a0c2e3
"""

import sqlalchemy as sa

from alembic import op

revision = "c5e7a9b1d3f4"
down_revision = "b4d6f8a0c2e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("platform_versions", sa.Column("major", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("platform_versions", sa.Column("minor", sa.Integer(), nullable=False, server_default="0"))
    op.execute("UPDATE platform_versions SET major = version_number, minor = 0")


def downgrade() -> None:
    op.drop_column("platform_versions", "minor")
    op.drop_column("platform_versions", "major")
