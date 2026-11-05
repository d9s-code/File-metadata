"""What has changed in a Platform's or an MDF's pins since its last saved
version — pins are changed (and stored) straight away, but only "Save
version" makes them part of a version, which is what an MDF pins and what
gets exported. Also the change summary between two MDF versions, Platforms
and the Emitters inside them, for the MDF's timeline and its release notes."""

from sqlalchemy.orm import Session

from app.models.mdf import Mdf, MdfVersion
from app.models.platform import Platform, PlatformVersion
from app.services import statuses
from app.services.pinned_diff_service import compute_pinned_diff, dwell_file_entries
from app.services.snapshots import build_mdf_snapshot, build_platform_snapshot

#: The status from which an MDF's pins are kept as they went out: no more
#: "outdated" warnings for it, or anything after it in the status order.
FROZEN_FROM = "released"


def pins_frozen(db: Session, mdf_status: str | None) -> bool:
    """Released, or a status after it (Deprecated, or one an Admin placed later)."""
    return statuses.at_or_after(db, "mdf", mdf_status, FROZEN_FROM)


def _latest(db: Session, model, owner_col, owner_id):
    return db.query(model).filter(owner_col == owner_id).order_by(model.version_number.desc()).first()


def platform_unsaved(db: Session, platform: Platform) -> dict:
    """{saved_version, entries}: the Emitter pins changed since the latest saved version."""
    latest = _latest(db, PlatformVersion, PlatformVersion.platform_id, platform.id)
    current = build_platform_snapshot(platform)
    entries = compute_pinned_diff(latest.snapshot if latest else {}, current, own="Platform", child="emitter")
    return {
        "saved_version": latest.version_number if latest else None,
        "entries": [e for e in entries if e["scope"].startswith("Emitter '")],
    }


def mdf_unsaved(db: Session, mdf: Mdf) -> dict:
    """{saved_version, entries}: the Platform pins and dwell files changed since the latest saved version."""
    latest = _latest(db, MdfVersion, MdfVersion.mdf_id, mdf.id)
    current = build_mdf_snapshot(mdf)
    old = latest.snapshot if latest else {}
    entries = compute_pinned_diff(old, current, own="MDF", child="platform") + (
        dwell_file_entries(old, current) if latest else []
    )
    return {
        "saved_version": latest.version_number if latest else None,
        "entries": [e for e in entries if not e["scope"].startswith("MDF")],
    }


def mdf_change_summary(db: Session, old: dict, new: dict) -> list[dict]:
    """Between two MDF snapshots: its own fields, Platforms pinned, unpinned or
    repinned — and for a repinned one, the Emitters that changed inside it —
    and its dwell files. Each entry: scope, label, kind, old_value, new_value."""
    labels = statuses.labels(db, "mdf")
    entries = compute_pinned_diff(old, new, own="MDF", child="platform", status_labels=labels)
    if not old:
        # From the very start: what it holds, not its own name and status "appearing".
        entries = [e for e in entries if not e["scope"].startswith("MDF")]
    before = {link["platform_id"]: link for link in old.get("links", [])}
    for link in new.get("links", []):
        prior = before.get(link["platform_id"])
        if prior and prior.get("platform_version_number") != link.get("platform_version_number"):
            inner = compute_pinned_diff(
                prior.get("platform_snapshot") or {}, link.get("platform_snapshot") or {}, own="Platform", child="emitter"
            )
            for e in inner:
                if e["scope"].startswith("Emitter '"):
                    entries.append({**e, "scope": f"Platform '{link['platform_name']}' → {e['scope']}"})
        elif not prior:
            for el in (link.get("platform_snapshot") or {}).get("links", []):
                entries.append(
                    {
                        "scope": f"Platform '{link['platform_name']}' → Emitter '{el['emitter_name']}'",
                        "label": "Included",
                        "kind": "added",
                        "old_value": None,
                        "new_value": f"At its v{el['emitter_version_number']}",
                    }
                )
    if old:
        entries += dwell_file_entries(old, new)
    return entries
