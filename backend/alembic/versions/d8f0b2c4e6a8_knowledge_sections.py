"""A copy of the documentation the language model may be given

The Outline pages set by OUTLINE_ROOT or OUTLINE_COLLECTION, split at their
headings, with a full-text index to pick the sections relevant to a
question. Rebuilt from Outline on each sync.

Revision ID: d8f0b2c4e6a8
Revises: c6e8a0b2d4f6
Create Date: 2026-10-07

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import TSVECTOR, UUID

from alembic import op

revision: str = "d8f0b2c4e6a8"
down_revision: Union[str, None] = "c6e8a0b2d4f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "knowledge_sections",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("outline_doc_id", sa.String(100), nullable=False),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("tokens", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("page_updated_at", sa.String(40), nullable=True),
        sa.Column(
            "search",
            TSVECTOR(),
            sa.Computed("to_tsvector('simple', path || ' ' || text)", persisted=True),
            nullable=True,
        ),
    )
    op.create_index("ix_knowledge_sections_outline_doc_id", "knowledge_sections", ["outline_doc_id"])
    op.create_index("ix_knowledge_sections_search", "knowledge_sections", ["search"], postgresql_using="gin")
    op.create_table(
        "knowledge_sync",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("label", sa.Text(), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pages", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sections", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tried_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("knowledge_sync")
    op.drop_index("ix_knowledge_sections_search", table_name="knowledge_sections")
    op.drop_index("ix_knowledge_sections_outline_doc_id", table_name="knowledge_sections")
    op.drop_table("knowledge_sections")
