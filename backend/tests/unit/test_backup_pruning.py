from datetime import datetime, timedelta, timezone
from pathlib import Path

from scripts.backup_db import prune_backups


def _touch_dump(d: Path, when: datetime) -> None:
    ts = when.strftime("%Y%m%d_%H%M%S")
    (d / f"emitterdb_{ts}.dump").touch()


def test_prune_keeps_within_retention_bounds(tmp_path: Path):
    now = datetime.now(timezone.utc)
    for i in range(20):
        _touch_dump(tmp_path, now - timedelta(days=i))
    for i in range(20, 300, 3):
        _touch_dump(tmp_path, now - timedelta(days=i))

    before = len(list(tmp_path.glob("*.dump")))
    removed = prune_backups(tmp_path, keep_daily=14, keep_weekly=8, keep_monthly=6)
    after = len(list(tmp_path.glob("*.dump")))

    assert after <= 14 + 8 + 6
    assert after == before - len(removed)


def test_prune_keeps_most_recent_daily_dumps_untouched(tmp_path: Path):
    now = datetime.now(timezone.utc)
    recent = [now - timedelta(days=i) for i in range(5)]
    for when in recent:
        _touch_dump(tmp_path, when)

    prune_backups(tmp_path, keep_daily=14, keep_weekly=8, keep_monthly=6)

    remaining = {p.name for p in tmp_path.glob("*.dump")}
    for when in recent:
        ts = when.strftime("%Y%m%d_%H%M%S")
        assert f"emitterdb_{ts}.dump" in remaining


def test_prune_empty_dir_is_a_noop(tmp_path: Path):
    removed = prune_backups(tmp_path, keep_daily=14, keep_weekly=8, keep_monthly=6)
    assert removed == []
