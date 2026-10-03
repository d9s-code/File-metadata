#!/usr/bin/env python3
"""Hard-deletes Emitters/Platforms/MDFs that have sat soft-deleted in the
trash past the retention window, meant to be run from OS cron (same pattern
as backup_db.py) — see the Admin > Recently Deleted UI for the manual
restore/purge-forever path this backs up.

Usage:
    python scripts/purge_deleted.py
"""

import sys

sys.path.insert(0, ".")

from app.config import settings  # noqa: E402
from app.services.trash_service import purge_expired  # noqa: E402


def main() -> None:
    purged = purge_expired()
    print(f"Purged {purged} item(s) past the {settings.trash_retention_days}-day retention window.")


if __name__ == "__main__":
    main()
