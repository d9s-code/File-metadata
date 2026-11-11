"""A Parameter Sequence's kind: a stagger or a dwell & switch

Set by hand or by an import's "sequence-type"; empty (guessed from the
steps) for every sequence until then.

Revision ID: d0f2b4c6e8a1
Revises: c8e0a2b4d6f7
"""

import sqlalchemy as sa

from alembic import op

revision = "d0f2b4c6e8a1"
down_revision = "c8e0a2b4d6f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("parameter_sequences", sa.Column("kind", sa.String(16), nullable=True))
    op.create_check_constraint(
        "ck_parameter_sequences_kind", "parameter_sequences", "kind IN ('stagger', 'dwell_switch')"
    )


def downgrade() -> None:
    op.drop_constraint("ck_parameter_sequences_kind", "parameter_sequences", type_="check")
    op.drop_column("parameter_sequences", "kind")
