"""Dwell files shared by many MDFs: each MDF pins a saved version

A dwell file used to belong to one MDF (dwell_files.mdf_id). Now any number
of MDFs can use it, each pinning a saved version of it, as they pin
Platform versions. Each file's MDF becomes a pin to its latest saved version.

Revision ID: b4d6f8a0c2e3
Revises: a3c5e7f9b1d2
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "b4d6f8a0c2e3"
down_revision = "a3c5e7f9b1d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mdf_dwell_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("mdf_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("mdfs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("dwell_file_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("dwell_files.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "dwell_file_version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("dwell_file_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("added_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("mdf_id", "dwell_file_id", name="uq_mdf_dwell_file"),
    )
    op.create_index("ix_mdf_dwell_links_mdf_id", "mdf_dwell_links", ["mdf_id"])
    op.create_index("ix_mdf_dwell_links_dwell_file_id", "mdf_dwell_links", ["dwell_file_id"])
    # Each file's MDF, pinned at the file's latest saved version (every file
    # is saved when it's made, so there is one).
    op.execute(
        """
        INSERT INTO mdf_dwell_links (id, mdf_id, dwell_file_id, dwell_file_version_id)
        SELECT gen_random_uuid(), f.mdf_id, f.id,
               (SELECT v.id FROM dwell_file_versions v WHERE v.dwell_file_id = f.id ORDER BY v.version_number DESC LIMIT 1)
        FROM dwell_files f
        WHERE f.mdf_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM dwell_file_versions v WHERE v.dwell_file_id = f.id)
        """
    )
    op.drop_index("ix_dwell_files_mdf_id", table_name="dwell_files", if_exists=True)
    op.drop_column("dwell_files", "mdf_id")


def downgrade() -> None:
    op.add_column(
        "dwell_files",
        sa.Column("mdf_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("mdfs.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_dwell_files_mdf_id", "dwell_files", ["mdf_id"])
    # Back to one MDF per file: the first it's pinned into.
    op.execute(
        """
        UPDATE dwell_files f SET mdf_id = (
            SELECT l.mdf_id FROM mdf_dwell_links l WHERE l.dwell_file_id = f.id ORDER BY l.added_at LIMIT 1
        )
        """
    )
    op.drop_table("mdf_dwell_links")
