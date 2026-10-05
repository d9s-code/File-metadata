"""AI drafts on ambiguity findings and runs

A language model's explanation of a finding, and its summary of a run, are
kept with them so they're generated once and seen by everyone — always
shown as a draft, with the model and who asked.

Revision ID: a1c4e7f9b2d3
Revises: f2b6d8a4c1e7
Create Date: 2026-10-05

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "a1c4e7f9b2d3"
down_revision: Union[str, None] = "f2b6d8a4c1e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("ambiguity_findings", sa.Column("ai_explanation", JSONB, nullable=True))
    op.add_column("ambiguity_runs", sa.Column("ai_summary", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("ambiguity_runs", "ai_summary")
    op.drop_column("ambiguity_findings", "ai_explanation")
