"""Notes, sequences, generation history and Intercept links outlive a revert

A Source's notes, sequences and cartesian-product runs, a generation
batch's EW Group and Source, and an Intercept entry's link to the Mode it
made all cascade-deleted with their Source, EW Group or Mode — so a revert
to a version without it, then back, lost them for good. They become plain
ids (no cascade): they stay while it's gone and show again when a revert or
discard brings it back with its id.

Revision ID: e7a9c1b3d5f6
Revises: d5f7b9a1c3e4
Create Date: 2026-10-20

"""

from typing import Sequence, Union

from alembic import op

revision: str = "e7a9c1b3d5f6"
down_revision: Union[str, None] = "d5f7b9a1c3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (table, column, referenced table)
_LINKS = [
    ("source_notes", "source_id", "sources"),
    ("parameter_sequences", "source_id", "sources"),
    ("cartesian_runs", "source_id", "sources"),
    ("mode_generation_batches", "source_id", "sources"),
    ("mode_generation_batches", "ew_group_id", "ew_groups"),
    ("intercept_entry_modes", "mode_id", "modes"),
]


def upgrade() -> None:
    for table, column, _ in _LINKS:
        op.drop_constraint(f"{table}_{column}_fkey", table, type_="foreignkey")


def downgrade() -> None:
    # Rows naming a row that's gone can't keep a foreign key.
    for table, column, target in reversed(_LINKS):
        op.execute(f"DELETE FROM {table} t WHERE NOT EXISTS (SELECT 1 FROM {target} r WHERE r.id = t.{column})")
        op.create_foreign_key(f"{table}_{column}_fkey", table, target, [column], ["id"], ondelete="CASCADE")
