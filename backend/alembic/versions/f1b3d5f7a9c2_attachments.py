"""Files kept with Emitters, Platforms and MDFs

Revision ID: f1b3d5f7a9c2
Revises: e2a4c6e8f0b1
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "f1b3d5f7a9c2"
down_revision = "e2a4c6e8f0b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("emitter_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("emitters.id", ondelete="CASCADE"), nullable=True),
        sa.Column("platform_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("platforms.id", ondelete="CASCADE"), nullable=True),
        sa.Column("mdf_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("mdfs.id", ondelete="CASCADE"), nullable=True),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(127), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("is_image", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("thumb", sa.LargeBinary(), nullable=True),
        sa.Column("uploaded_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("num_nonnulls(emitter_id, platform_id, mdf_id) = 1", name="ck_attachments_one_owner"),
    )
    op.create_index("ix_attachments_emitter_id", "attachments", ["emitter_id"])
    op.create_index("ix_attachments_platform_id", "attachments", ["platform_id"])
    op.create_index("ix_attachments_mdf_id", "attachments", ["mdf_id"])


def downgrade() -> None:
    op.drop_table("attachments")
