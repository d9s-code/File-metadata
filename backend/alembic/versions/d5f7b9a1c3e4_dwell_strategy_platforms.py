"""Dwell Strategies for any number of Platforms, or none (default dwells)

A Strategy was one Platform's; now it lists the Platforms it covers in
dwell_strategy_platforms — several, or none for a default dwell. Saved
versions (and the dwell file versions that embed them) keep
platform_ids / platform_names lists instead of one platform_id / name.

Revision ID: d5f7b9a1c3e4
Revises: c3e5a7b9d1f3
Create Date: 2026-10-20

"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "d5f7b9a1c3e4"
down_revision: Union[str, None] = "c3e5a7b9d1f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _to_lists(snapshot: dict) -> dict:
    if "platform_ids" in snapshot:
        return snapshot
    out = dict(snapshot)
    pid, name = out.pop("platform_id", None), out.pop("platform_name", None)
    out["platform_ids"] = [pid] if pid else []
    out["platform_names"] = [name] if name else []
    return out


def _to_one(snapshot: dict) -> dict:
    if "platform_ids" not in snapshot:
        return snapshot
    out = dict(snapshot)
    ids, names = out.pop("platform_ids") or [], out.pop("platform_names") or []
    out["platform_id"] = ids[0] if ids else None
    out["platform_name"] = names[0] if names else None
    return out


def _rewrite(convert) -> None:
    conn = op.get_bind()
    for vid, snap in conn.execute(sa.text("SELECT id, snapshot FROM dwell_strategy_versions")).all():
        conn.execute(
            sa.text("UPDATE dwell_strategy_versions SET snapshot = CAST(:s AS jsonb) WHERE id = :id"),
            {"s": json.dumps(convert(snap)), "id": vid},
        )
    for vid, snap in conn.execute(sa.text("SELECT id, snapshot FROM dwell_file_versions")).all():
        snap = dict(snap)
        snap["strategies"] = [dict(s, snapshot=convert(s["snapshot"])) for s in snap.get("strategies", [])]
        conn.execute(
            sa.text("UPDATE dwell_file_versions SET snapshot = CAST(:s AS jsonb) WHERE id = :id"),
            {"s": json.dumps(snap), "id": vid},
        )


def upgrade() -> None:
    op.create_table(
        "dwell_strategy_platforms",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "strategy_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("dwell_strategies.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "platform_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("platforms.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("strategy_id", "platform_id", name="uq_dwell_strategy_platform"),
    )
    op.execute(
        "INSERT INTO dwell_strategy_platforms (id, strategy_id, platform_id, sort_order) "
        "SELECT gen_random_uuid(), id, platform_id, 0 FROM dwell_strategies WHERE platform_id IS NOT NULL"
    )
    op.drop_constraint("uq_dwell_strategy_platform_name", "dwell_strategies", type_="unique")
    op.drop_column("dwell_strategies", "platform_id")
    _rewrite(_to_lists)


def downgrade() -> None:
    op.add_column(
        "dwell_strategies",
        sa.Column(
            "platform_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("platforms.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_dwell_strategies_platform_id", "dwell_strategies", ["platform_id"])
    # A Strategy keeps the first of its Platforms.
    op.execute(
        "UPDATE dwell_strategies s SET platform_id = p.platform_id FROM ("
        "  SELECT DISTINCT ON (strategy_id) strategy_id, platform_id FROM dwell_strategy_platforms"
        "  ORDER BY strategy_id, sort_order) p WHERE p.strategy_id = s.id"
    )
    op.drop_table("dwell_strategy_platforms")
    op.create_unique_constraint("uq_dwell_strategy_platform_name", "dwell_strategies", ["platform_id", "name"])
    _rewrite(_to_one)
