"""Dwell Strategies on their own (named, per Platform, versioned), pinned into
versioned dwell files; tests can record the Strategy version used

Revision ID: d4f6b8c0e2a3
Revises: c3e5a7b9d1f2
Create Date: 2026-10-15

"""
import json
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision: str = "d4f6b8c0e2a3"
down_revision: Union[str, None] = "c3e5a7b9d1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("dwell_strategies", sa.Column("name", sa.String(200), nullable=True))
    op.add_column("dwell_strategies", sa.Column("notes", sa.Text(), nullable=True))
    op.add_column("dwell_strategies", sa.Column("bandwidth_mhz", sa.Float(), nullable=True))
    op.add_column(
        "dwell_strategies",
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.alter_column("dwell_strategies", "merged_mode", new_column_name="dwells")

    op.create_table(
        "dwell_strategy_versions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "strategy_id", UUID(as_uuid=True), sa.ForeignKey("dwell_strategies.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("snapshot", JSONB(), nullable=False),
        sa.Column("change_summary", sa.Text(), nullable=True),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("strategy_id", "version_number", name="uq_dwell_strategy_version_number"),
    )
    op.create_index("ix_dwell_strategy_versions_strategy_id", "dwell_strategy_versions", ["strategy_id"])
    op.create_table(
        "dwell_file_strategies",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "dwell_file_id", UUID(as_uuid=True), sa.ForeignKey("dwell_files.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "strategy_id", UUID(as_uuid=True), sa.ForeignKey("dwell_strategies.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column(
            "strategy_version_id",
            UUID(as_uuid=True),
            sa.ForeignKey("dwell_strategy_versions.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("dwell_file_id", "strategy_id", name="uq_dwell_file_strategy"),
    )
    op.create_index("ix_dwell_file_strategies_dwell_file_id", "dwell_file_strategies", ["dwell_file_id"])
    op.create_index("ix_dwell_file_strategies_strategy_id", "dwell_file_strategies", ["strategy_id"])
    op.create_table(
        "dwell_file_versions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "dwell_file_id", UUID(as_uuid=True), sa.ForeignKey("dwell_files.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("snapshot", JSONB(), nullable=False),
        sa.Column("change_summary", sa.Text(), nullable=True),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("dwell_file_id", "version_number", name="uq_dwell_file_version_number"),
    )
    op.create_index("ix_dwell_file_versions_dwell_file_id", "dwell_file_versions", ["dwell_file_id"])

    # Each Strategy a file had becomes one of its own — named after the file
    # and its place in it, with a first saved version — pinned into the file.
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT s.id, s.dwell_file_id, s.platform_id, s.sort_order, s.manual_collect_time_ms, s.dwells, "
            "s.rapid_df, s.split_mode, f.name, f.created_by, f.bandwidth_mhz, p.name "
            "FROM dwell_strategies s JOIN dwell_files f ON f.id = s.dwell_file_id "
            "LEFT JOIN platforms p ON p.id = s.platform_id ORDER BY f.name, s.sort_order"
        )
    ).fetchall()
    place: dict = {}
    pinned: dict = {}  # file id -> [(sort_order, strategy id, version id, snapshot)]
    for sid, file_id, platform_id, sort_order, manual, dwells, rapid, split, file_name, creator, bandwidth, pname in rows:
        place[file_id] = place.get(file_id, 0) + 1
        name = f"{file_name} — Strategy {place[file_id]}"
        bind.execute(
            sa.text("UPDATE dwell_strategies SET name = :n, created_by = :c, bandwidth_mhz = :b WHERE id = :id"),
            {"n": name, "c": creator, "b": bandwidth, "id": sid},
        )
        snapshot = {
            "name": name,
            "platform_id": str(platform_id) if platform_id else None,
            "platform_name": pname,
            "notes": None,
            "manual_collect_time_ms": manual,
            "dwells": dwells or [],
            "rapid_df": rapid,
            "split_mode": split,
        }
        version_id = uuid.uuid4()
        bind.execute(
            sa.text(
                "INSERT INTO dwell_strategy_versions (id, strategy_id, version_number, snapshot, change_summary, created_by) "
                "VALUES (:id, :s, 1, CAST(:snap AS JSONB), 'Made from its dwell file', :c)"
            ),
            {"id": version_id, "s": sid, "snap": json.dumps(snapshot), "c": creator},
        )
        bind.execute(
            sa.text(
                "INSERT INTO dwell_file_strategies (id, dwell_file_id, strategy_id, strategy_version_id, sort_order) "
                "VALUES (:id, :f, :s, :v, :o)"
            ),
            {"id": uuid.uuid4(), "f": file_id, "s": sid, "v": version_id, "o": sort_order},
        )
        pinned.setdefault(file_id, []).append((sort_order, sid, version_id, snapshot))

    # Each file gets a first saved version too, as it stands: an MDF's export
    # carries a file's latest saved version.
    files = bind.execute(
        sa.text(
            "SELECT f.id, f.name, f.mdf_id, m.name, f.timeout, f.setup_time, f.notes, f.created_by "
            "FROM dwell_files f LEFT JOIN mdfs m ON m.id = f.mdf_id"
        )
    ).fetchall()
    for file_id, file_name, mdf_id, mdf_name, timeout, setup_time, notes, creator in files:
        snapshot = {
            "name": file_name,
            "mdf_id": str(mdf_id) if mdf_id else None,
            "mdf_name": mdf_name,
            "timeout": timeout,
            "setup_time": setup_time,
            "notes": notes,
            "strategies": [
                {
                    "strategy_id": str(sid),
                    "strategy_version_id": str(vid),
                    "strategy_version_number": 1,
                    "snapshot": snap,
                }
                for _, sid, vid, snap in sorted(pinned.get(file_id, []), key=lambda p: p[0])
            ],
        }
        bind.execute(
            sa.text(
                "INSERT INTO dwell_file_versions (id, dwell_file_id, version_number, snapshot, change_summary, created_by) "
                "VALUES (:id, :f, 1, CAST(:snap AS JSONB), 'The file as it was', :c)"
            ),
            {"id": uuid.uuid4(), "f": file_id, "snap": json.dumps(snapshot), "c": creator},
        )

    op.drop_constraint("uq_dwell_strategy_platform", "dwell_strategies", type_="unique")
    op.drop_index("ix_dwell_strategies_dwell_file_id", table_name="dwell_strategies")
    op.drop_column("dwell_strategies", "dwell_file_id")
    op.drop_column("dwell_strategies", "sort_order")
    op.alter_column("dwell_strategies", "name", nullable=False)
    op.create_unique_constraint("uq_dwell_strategy_platform_name", "dwell_strategies", ["platform_id", "name"])
    op.drop_column("dwell_files", "bandwidth_mhz")

    for table in ("test_records", "platform_tests"):
        op.add_column(
            table,
            sa.Column(
                "dwell_strategy_version_id",
                UUID(as_uuid=True),
                sa.ForeignKey("dwell_strategy_versions.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )


def downgrade() -> None:
    # Back to Strategies inside one file each; Strategies in no file, and
    # versions, are dropped.
    for table in ("test_records", "platform_tests"):
        op.drop_column(table, "dwell_strategy_version_id")
    op.add_column("dwell_files", sa.Column("bandwidth_mhz", sa.Float(), nullable=True))
    op.drop_constraint("uq_dwell_strategy_platform_name", "dwell_strategies", type_="unique")
    op.add_column("dwell_strategies", sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"))
    op.add_column(
        "dwell_strategies",
        sa.Column("dwell_file_id", UUID(as_uuid=True), sa.ForeignKey("dwell_files.id", ondelete="CASCADE"), nullable=True),
    )
    op.execute(
        "UPDATE dwell_strategies s SET dwell_file_id = l.dwell_file_id, sort_order = l.sort_order "
        "FROM dwell_file_strategies l WHERE l.strategy_id = s.id"
    )
    op.execute("DELETE FROM dwell_strategies WHERE dwell_file_id IS NULL")
    op.drop_table("dwell_file_versions")
    op.drop_table("dwell_file_strategies")
    op.drop_table("dwell_strategy_versions")
    op.alter_column("dwell_strategies", "dwell_file_id", nullable=False)
    op.create_index("ix_dwell_strategies_dwell_file_id", "dwell_strategies", ["dwell_file_id"])
    op.create_unique_constraint("uq_dwell_strategy_platform", "dwell_strategies", ["dwell_file_id", "platform_id"])
    op.alter_column("dwell_strategies", "dwells", new_column_name="merged_mode")
    for column in ("created_by", "bandwidth_mhz", "notes", "name"):
        op.drop_column("dwell_strategies", column)
