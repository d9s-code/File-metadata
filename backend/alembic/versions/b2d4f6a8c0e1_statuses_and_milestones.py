"""Statuses set up by Admins, Platform status, and milestones

Emitter and MDF statuses become keys into status_definitions (so Admins can
rename, recolour and add them); Platforms get a status; milestones are what
to get done before an item reaches a status.

Revision ID: b2d4f6a8c0e1
Revises: a1c3e5b7d9f2
Create Date: 2026-10-16

"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "b2d4f6a8c0e1"
down_revision: Union[str, None] = "a1c3e5b7d9f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "status_definitions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("entity_type", sa.String(20), nullable=False, index=True),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("label", sa.String(60), nullable=False),
        sa.Column("color", sa.String(20), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("builtin", sa.Boolean(), nullable=False),
        sa.Column("transitions", postgresql.ARRAY(sa.String(64)), nullable=False),
        sa.Column("requires_note", sa.Boolean(), nullable=False),
        sa.Column("note_prompt", sa.String(200), nullable=True),
        sa.UniqueConstraint("entity_type", "key", name="uq_status_definition_key"),
    )
    op.create_table(
        "milestone_definitions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("entity_type", sa.String(20), nullable=False, index=True),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=True, index=True),
        sa.Column("status_key", sa.String(64), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "milestone_checks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "milestone_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("milestone_definitions.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=False, index=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("done_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("milestone_id", "entity_id", name="uq_milestone_check"),
    )
    # Statuses are keys now, not a fixed enum.
    op.execute("ALTER TABLE emitters ALTER COLUMN status TYPE VARCHAR(64) USING status::text")
    op.execute("ALTER TABLE mdfs ALTER COLUMN status TYPE VARCHAR(64) USING status::text")
    op.execute("DROP TYPE emitterstatus")
    op.execute("DROP TYPE mdfstatus")
    op.add_column("platforms", sa.Column("status", sa.String(64), nullable=False, server_default="draft"))


def downgrade() -> None:
    op.drop_column("platforms", "status")
    # Statuses Admins added fall back to the first one.
    op.execute(
        "UPDATE emitters SET status = 'draft' WHERE status NOT IN "
        "('draft', 'in_review', 'partially_operational', 'validated', 'deprecated')"
    )
    op.execute(
        "UPDATE mdfs SET status = 'draft' WHERE status NOT IN "
        "('draft', 'pending_review', 'approved', 'released', 'deprecated')"
    )
    op.execute(
        "CREATE TYPE emitterstatus AS ENUM ('draft', 'in_review', 'partially_operational', 'validated', 'deprecated')"
    )
    op.execute("CREATE TYPE mdfstatus AS ENUM ('draft', 'pending_review', 'approved', 'released', 'deprecated')")
    op.execute("ALTER TABLE emitters ALTER COLUMN status TYPE emitterstatus USING status::emitterstatus")
    op.execute("ALTER TABLE mdfs ALTER COLUMN status TYPE mdfstatus USING status::mdfstatus")
    op.drop_table("milestone_checks")
    op.drop_table("milestone_definitions")
    op.drop_table("status_definitions")
