"""Test history outlives the Modes and Test Lines it names

Deleting a Mode or Test Line (including a revert to a version without it)
used to cascade-delete the test results that named it, so reverting back
left runs with only their overall result. The links become plain ids (no
cascade), each keeping the name it had, so results survive — and link up
again when a revert brings the Mode or Test Line back with its id.

Revision ID: c3e5a7b9d1f3
Revises: b2d4f6a8c0e1
Create Date: 2026-10-20

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "c3e5a7b9d1f3"
down_revision: Union[str, None] = "b2d4f6a8c0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("test_record_modes", sa.Column("mode_name", sa.String(200), nullable=True))
    op.add_column("test_record_line_modes", sa.Column("mode_name", sa.String(200), nullable=True))
    op.add_column("test_record_lines", sa.Column("test_line_label", sa.Text(), nullable=True))
    op.execute("UPDATE test_record_modes t SET mode_name = m.name FROM modes m WHERE m.id = t.mode_id")
    op.execute("UPDATE test_record_line_modes t SET mode_name = m.name FROM modes m WHERE m.id = t.mode_id")
    op.execute("UPDATE test_record_lines t SET test_line_label = l.label FROM test_lines l WHERE l.id = t.test_line_id")
    op.drop_constraint("test_record_modes_mode_id_fkey", "test_record_modes", type_="foreignkey")
    op.drop_constraint("test_record_line_modes_mode_id_fkey", "test_record_line_modes", type_="foreignkey")
    op.drop_constraint("test_record_lines_test_line_id_fkey", "test_record_lines", type_="foreignkey")
    op.create_index("ix_test_record_modes_mode_id", "test_record_modes", ["mode_id"])


def downgrade() -> None:
    # Rows naming a Mode or Test Line that's gone can't keep a foreign key.
    op.execute("DELETE FROM test_record_modes t WHERE NOT EXISTS (SELECT 1 FROM modes m WHERE m.id = t.mode_id)")
    op.execute(
        "DELETE FROM test_record_line_modes t WHERE NOT EXISTS (SELECT 1 FROM modes m WHERE m.id = t.mode_id)"
    )
    op.execute(
        "DELETE FROM test_record_lines t WHERE NOT EXISTS (SELECT 1 FROM test_lines l WHERE l.id = t.test_line_id)"
    )
    op.drop_index("ix_test_record_modes_mode_id", "test_record_modes")
    op.create_foreign_key(
        "test_record_lines_test_line_id_fkey", "test_record_lines", "test_lines", ["test_line_id"], ["id"], ondelete="CASCADE"
    )
    op.create_foreign_key(
        "test_record_line_modes_mode_id_fkey", "test_record_line_modes", "modes", ["mode_id"], ["id"], ondelete="CASCADE"
    )
    op.create_foreign_key(
        "test_record_modes_mode_id_fkey", "test_record_modes", "modes", ["mode_id"], ["id"], ondelete="CASCADE"
    )
    op.drop_column("test_record_lines", "test_line_label")
    op.drop_column("test_record_line_modes", "mode_name")
    op.drop_column("test_record_modes", "mode_name")
