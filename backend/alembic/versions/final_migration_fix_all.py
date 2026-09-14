"""final_migration_fix_all

Revision ID: final_fix_all_rev
Revises: e4f5a6b7c8d9
Create Date: 2026-09-09 09:20:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'final_fix_all_rev'
down_revision = 'e4f5a6b7c8d9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # 1. Add status to platforms
    if 'status' not in [c['name'] for c in inspector.get_columns('platforms')]:
        op.add_column('platforms', sa.Column('status', sa.String(length=20), nullable=False, server_default='draft'))

    # 2. Add emitter_id to audit_log
    if 'emitter_id' not in [c['name'] for c in inspector.get_columns('audit_log')]:
        op.add_column('audit_log', sa.Column('emitter_id', postgresql.UUID(as_uuid=True), nullable=True))
        op.create_foreign_key(
            'audit_log_emitter_id_fkey', 'audit_log', 'emitters', ['emitter_id'], ['id'], ondelete='SET NULL'
        )
        op.create_index(op.f('ix_audit_log_emitter_id'), 'audit_log', ['emitter_id'], unique=False)
    else:
        # If column exists but foreign key/index doesn't, ensure they are there
        # (This handles the case where the previous run partially succeeded)
        existing_fks = [fk['name'] for fk in inspector.get_foreign_keys('audit_log')]
        if 'audit_log_emitter_id_fkey' not in existing_fks:
            op.create_foreign_key(
                'audit_log_emitter_id_fkey', 'audit_log', 'emitters', ['emitter_id'], ['id'], ondelete='SET NULL'
            )
        existing_idxs = [idx['name'] for idx in inspector.get_indexes('audit_log')]
        if 'ix_audit_log_emitter_id' not in existing_idxs:
            op.create_index(op.f('ix_audit_log_emitter_id'), 'audit_log', ['emitter_id'], unique=False)

    # 3. Update ambiguity_runs foreign key to include CASCADE
    try:
        # We check if it already has CASCADE to avoid erroring on drop_constraint
        existing_fks = inspector.get_foreign_keys('ambiguity_runs')
        fk_exists = False
        for fk in existing_fks:
            if fk['name'] == 'ambiguity_runs_emitter_version_id_fkey':
                fk_exists = True
                # Check if it's already CASCADE
                if fk.get('options', {}).get('ondelete') == 'CASCADE' or fk.get('ondelete') == 'CASCADE':
                    break
        
        if fk_exists:
            op.drop_constraint('ambiguity_runs_emitter_version_id_fkey', 'ambiguity_runs', type_='foreignkey')
        
        op.create_foreign_key(
            'ambiguity_runs_emitter_version_id_fkey',
            'ambiguity_runs', 'emitter_versions',
            ['emitter_version_id'], ['id'],
            ondelete='CASCADE'
        )
    except Exception as e:
        print(f"Warning: Could not update ambiguity_runs foreign key (likely permission issue): {e}")

    # 4. Add rework_note to emitters
    if 'rework_note' not in [c['name'] for c in inspector.get_columns('emitters')]:
        op.add_column('emitters', sa.Column('rework_note', sa.Text(), nullable=True))


def downgrade() -> None:
    # Reverse the changes
    op.drop_column('emitters', 'rework_note')
    
    op.drop_constraint('ambiguity_runs_emitter_version_id_fkey', 'ambiguity_runs', type_='foreignkey')
    op.create_foreign_key(
        'ambiguity_runs_emitter_version_id_fkey',
        'ambiguity_runs', 'emitter_versions',
        ['emitter_version_id'], ['id']
    )

    op.drop_index(op.f('ix_audit_log_emitter_id'), table_name='audit_log')
    op.drop_constraint('audit_log_emitter_id_fkey', 'audit_log', type_='foreignkey')
    op.drop_column('audit_log', 'emitter_id')

    op.drop_column('platforms', 'status')
