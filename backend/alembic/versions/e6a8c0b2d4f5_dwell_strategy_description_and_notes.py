"""Dwell Strategies: the free-text field becomes a description (shown in
lists), and Strategies get an analyst notes feed like Platforms

Revision ID: e6a8c0b2d4f5
Revises: d4f6b8c0e2a3
Create Date: 2026-10-16

"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision: str = "e6a8c0b2d4f5"
down_revision: Union[str, None] = "d4f6b8c0e2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _rename_key(snapshot: dict, old: str, new: str) -> dict:
    if old in snapshot:
        snapshot = dict(snapshot)
        snapshot[new] = snapshot.pop(old)
    return snapshot


def _rewrite_snapshots(old: str, new: str) -> None:
    """Saved versions keep the Strategy's field under its new name too —
    the Strategies' own, and the copies inside the dwell files' versions."""
    bind = op.get_bind()
    for vid, snap in bind.execute(sa.text("SELECT id, snapshot FROM dwell_strategy_versions")).fetchall():
        bind.execute(
            sa.text("UPDATE dwell_strategy_versions SET snapshot = CAST(:s AS JSONB) WHERE id = :id"),
            {"s": json.dumps(_rename_key(snap, old, new)), "id": vid},
        )
    for vid, snap in bind.execute(sa.text("SELECT id, snapshot FROM dwell_file_versions")).fetchall():
        snap = dict(snap)
        snap["strategies"] = [
            dict(s, snapshot=_rename_key(s.get("snapshot") or {}, old, new)) for s in snap.get("strategies") or []
        ]
        bind.execute(
            sa.text("UPDATE dwell_file_versions SET snapshot = CAST(:s AS JSONB) WHERE id = :id"),
            {"s": json.dumps(snap), "id": vid},
        )


def upgrade() -> None:
    op.alter_column("dwell_strategies", "notes", new_column_name="description")
    _rewrite_snapshots("notes", "description")
    op.create_table(
        "dwell_strategy_notes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "strategy_id", UUID(as_uuid=True), sa.ForeignKey("dwell_strategies.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("author_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_dwell_strategy_notes_strategy_id", "dwell_strategy_notes", ["strategy_id"])
    op.create_index("ix_dwell_strategy_notes_created_at", "dwell_strategy_notes", ["created_at"])


def downgrade() -> None:
    op.drop_table("dwell_strategy_notes")
    _rewrite_snapshots("description", "notes")
    op.alter_column("dwell_strategies", "description", new_column_name="notes")
