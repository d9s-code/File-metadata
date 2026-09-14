"""source_groups_and_element_details

Adds Source Groups (a cross-Emitter label for Sources), a few new
descriptive Source/ModeElement fields, and two FK CASCADE fixes that were
missing (ambiguity_runs -> emitter_versions, platform_emitter_links ->
emitters) so hard-deleting an Emitter or an Emitter version doesn't leave a
dangling reference behind.

Revision ID: f5a6b7c8d9e0
Revises: e4f5a6b7c8d9
Create Date: 2026-09-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'f5a6b7c8d9e0'
down_revision: Union[str, None] = 'e4f5a6b7c8d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'source_groups',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    op.add_column('sources', sa.Column('rf_legacy_term', sa.Text(), nullable=True))
    op.add_column('sources', sa.Column('pri_legacy_term', sa.Text(), nullable=True))
    op.add_column('sources', sa.Column('source_type', sa.String(length=50), nullable=True))
    op.create_index(op.f('ix_sources_source_type'), 'sources', ['source_type'], unique=False)
    op.add_column('sources', sa.Column('group_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index(op.f('ix_sources_group_id'), 'sources', ['group_id'], unique=False)
    op.create_foreign_key(
        'sources_group_id_fkey', 'sources', 'source_groups', ['group_id'], ['id'], ondelete='SET NULL'
    )

    op.add_column('mode_elements', sa.Column('details', sa.Text(), nullable=True))

    op.drop_constraint('ambiguity_runs_emitter_version_id_fkey', 'ambiguity_runs', type_='foreignkey')
    op.create_foreign_key(
        'ambiguity_runs_emitter_version_id_fkey',
        'ambiguity_runs', 'emitter_versions', ['emitter_version_id'], ['id'], ondelete='CASCADE',
    )

    op.drop_constraint('platform_emitter_links_emitter_id_fkey', 'platform_emitter_links', type_='foreignkey')
    op.create_foreign_key(
        'platform_emitter_links_emitter_id_fkey',
        'platform_emitter_links', 'emitters', ['emitter_id'], ['id'], ondelete='CASCADE',
    )


def downgrade() -> None:
    op.drop_constraint('platform_emitter_links_emitter_id_fkey', 'platform_emitter_links', type_='foreignkey')
    op.create_foreign_key(
        'platform_emitter_links_emitter_id_fkey', 'platform_emitter_links', 'emitters', ['emitter_id'], ['id'],
    )

    op.drop_constraint('ambiguity_runs_emitter_version_id_fkey', 'ambiguity_runs', type_='foreignkey')
    op.create_foreign_key(
        'ambiguity_runs_emitter_version_id_fkey', 'ambiguity_runs', 'emitter_versions', ['emitter_version_id'], ['id'],
    )

    op.drop_column('mode_elements', 'details')

    op.drop_constraint('sources_group_id_fkey', 'sources', type_='foreignkey')
    op.drop_index(op.f('ix_sources_group_id'), table_name='sources')
    op.drop_column('sources', 'group_id')
    op.drop_index(op.f('ix_sources_source_type'), table_name='sources')
    op.drop_column('sources', 'source_type')
    op.drop_column('sources', 'pri_legacy_term')
    op.drop_column('sources', 'rf_legacy_term')

    op.drop_table('source_groups')
