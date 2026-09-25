"""Rename Emitter statuses in stored status-change summaries

Status changes used to be summarized with the stored values
("Status: draft → in_review"); they're now written with the names people
see ("Status: In progress → Testing"). Rewrites the ones already stored in
version history and the audit log so old and new entries read the same.

Revision ID: b3e8f1a4c9d2
Revises: a9d3e7f2c6b1
Create Date: 2026-09-25

"""
import re
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "b3e8f1a4c9d2"
down_revision: Union[str, None] = "a9d3e7f2c6b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LABELS = {"draft": "In progress", "in_review": "Testing", "validated": "Operational", "deprecated": "Needs rework"}
_PATTERN = re.compile(r"Status: (draft|in_review|validated|deprecated) → (draft|in_review|validated|deprecated)")


def _rewrite(table: str, column: str, labels: dict[str, str], pattern: re.Pattern, where: str = "TRUE") -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(f"SELECT id, {column} FROM {table} WHERE {column} LIKE '%Status: %' AND {where}")
    ).fetchall()
    for row_id, text in rows:
        new = pattern.sub(lambda m: f"Status: {labels[m.group(1)]} → {labels[m.group(2)]}", text, count=1)
        if new != text:
            conn.execute(sa.text(f"UPDATE {table} SET {column} = :v WHERE id = :id"), {"v": new, "id": row_id})


def upgrade() -> None:
    _rewrite("emitter_versions", "change_summary", LABELS, _PATTERN)
    # MDFs have draft/deprecated statuses too — only Emitter entries are renamed.
    _rewrite("audit_log", "summary", LABELS, _PATTERN, "entity_type = 'emitter'")


def downgrade() -> None:
    reverse = {v: k for k, v in LABELS.items()}
    names = "|".join(re.escape(v) for v in reverse)
    pattern = re.compile(rf"Status: ({names}) → ({names})")
    _rewrite("emitter_versions", "change_summary", reverse, pattern)
    _rewrite("audit_log", "summary", reverse, pattern, "entity_type = 'emitter'")
