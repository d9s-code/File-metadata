"""Documentation sections keep their page

Each copied Outline section keeps the page it came from ("Parent › Page"),
so an admin can say what kind of content each page holds — documentation,
test results, analysis — and the AI is told which it's reading. Filled on
the next sync.

Revision ID: b6d8f0a2c4e6
Revises: a4c6e8f0b2d4
Create Date: 2026-10-27

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b6d8f0a2c4e6"
down_revision: Union[str, None] = "a4c6e8f0b2d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("knowledge_sections", sa.Column("page_path", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("knowledge_sections", "page_path")
