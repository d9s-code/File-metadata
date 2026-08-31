#!/usr/bin/env python3
"""Hard-deletes Emitters/Platforms/MDFs that have sat soft-deleted in the
trash past the retention window, meant to be run from OS cron (same pattern
as backup_db.py) — see the Admin > Recently Deleted UI for the manual
restore/purge-forever path this backs up.

Usage:
    python scripts/purge_deleted.py
"""

import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, ".")

from app.config import settings  # noqa: E402
from app.core.enums import AuditAction, AuditEntityType  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.models.emitter import Emitter  # noqa: E402
from app.models.mdf import Mdf  # noqa: E402
from app.models.platform import Platform  # noqa: E402
from app.services.audit_service import record_audit  # noqa: E402

_TARGETS = [
    (Emitter, AuditEntityType.emitter, "Emitter"),
    (Platform, AuditEntityType.platform, "Platform"),
    (Mdf, AuditEntityType.mdf, "MDF"),
]


def main() -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.trash_retention_days)
    db = SessionLocal()
    purged = 0
    try:
        for model, entity_type, label in _TARGETS:
            rows = (
                db.query(model)
                .filter(model.is_deleted.is_(True), model.deleted_at.isnot(None), model.deleted_at < cutoff)
                .all()
            )
            for row in rows:
                record_audit(
                    db,
                    actor_id=None,
                    action=AuditAction.delete,
                    entity_type=entity_type.value,
                    entity_id=row.id,
                    summary=f"Auto-purged {label} '{row.name}' after {settings.trash_retention_days}-day retention window",
                )
                db.delete(row)
                purged += 1
        db.commit()
    finally:
        db.close()
    print(f"Purged {purged} item(s) past the {settings.trash_retention_days}-day retention window.")


if __name__ == "__main__":
    main()
