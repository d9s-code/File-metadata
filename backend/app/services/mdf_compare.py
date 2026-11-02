"""Two MDFs side by side, or one MDF at two points: each side is an MDF at a
saved version, or as it is now (its current pins). What changed from the
first side to the second: Platforms and Emitters in and out, their versions
and statuses, and the Modes that are new, gone or changed.

Status isn't held by versions (a status move saves none), so each side's
statuses are read from the Audit Log as they stood when that side's MDF
version was saved; "now" uses the current ones.
"""

from datetime import datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.enums import AuditAction, AuditEntityType
from app.models.audit_log import AuditLog
from app.models.emitter import Emitter
from app.models.mdf import Mdf, MdfVersion
from app.models.platform import Platform
from app.services.snapshots import build_mdf_snapshot

# What a Mode's change is reported as, and the snapshot fields behind each.
_MODE_FIELDS: list[tuple[str, list[str]]] = [
    ("Name", ["name"]),
    ("PRI type", ["pri_type"]),
    ("RF", ["line.rf_min_mhz", "line.rf_max_mhz", "line.rf_delta", "line.rf_range_matching"]),
    ("PW", ["line.pw_min_us", "line.pw_max_us", "line.pw_delta", "line.pw_range_matching"]),
    (
        "PRI",
        [
            "line.pri_min_us",
            "line.pri_max_us",
            "line.pri_delta",
            "line.pri_range_matching",
            "line.frame_time_delta_us",
            "line.explicit_frame_time_us",
        ],
    ),
    ("Jitter", ["line.jitter_min_us", "line.jitter_max_us"]),
    # dsl_text is written from the other fields, so it is left out.
    ("Stagger", ["line.pri_stagger_values_us", "line.type_data"]),
    ("Sources", ["source_names"]),
    ("Confirmation", ["confirmation_quality", "confirmation_quantity"]),
    ("Group", ["group_name"]),
    ("Notes", ["notes"]),
]


def _field(mode: dict, path: str):
    if path.startswith("line."):
        return (mode.get("line") or {}).get(path[5:])
    return mode.get(path)


def _changed_fields(old: dict, new: dict) -> list[str]:
    return [name for name, paths in _MODE_FIELDS if any(_field(old, p) != _field(new, p) for p in paths)]


def _num(v: float | None) -> str:
    if v is None:
        return "?"
    return f"{v:,.6g}" if abs(v) < 1e6 else f"{v:,.0f}"


def _span(lo: float | None, hi: float | None, unit: str) -> str | None:
    if lo is None and hi is None:
        return None
    if lo == hi or hi is None:
        return f"{_num(lo)} {unit}"
    return f"{_num(lo)}–{_num(hi)} {unit}"


def mode_summary(mode: dict) -> str:
    """A Mode's ranges in one line: RF, PRI (or its stagger) and PW."""
    line = mode.get("line") or {}
    parts = []
    rf = _span(line.get("rf_min_mhz"), line.get("rf_max_mhz"), "MHz")
    if rf:
        parts.append(f"RF {rf}")
    stagger = line.get("pri_stagger_values_us")
    if stagger:
        parts.append("PRI " + "/".join(_num(v) for v in stagger) + " µs")
    else:
        pri = _span(line.get("pri_min_us"), line.get("pri_max_us"), "µs")
        if pri:
            parts.append(f"PRI {pri}")
    pw = _span(line.get("pw_min_us"), line.get("pw_max_us"), "µs")
    if pw:
        parts.append(f"PW {pw}")
    return " · ".join(parts)


def _side(db: Session, mdf_id: UUID, version: int | None) -> tuple[Mdf, dict, datetime | None]:
    mdf = db.get(Mdf, mdf_id)
    if mdf is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MDF not found")
    if version is None:
        return mdf, build_mdf_snapshot(mdf), None
    row = db.query(MdfVersion).filter(MdfVersion.mdf_id == mdf_id, MdfVersion.version_number == version).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"'{mdf.name}' has no v{version}")
    return mdf, row.snapshot, row.created_at


def _statuses_at(db: Session, entity_type: str, now: dict[str, str], when: datetime | None) -> dict[str, str]:
    """Each one's status as it stood at `when` (None: now). The last move
    before then says where it was; failing that, the first move after it
    says where it came from; with no move at all, it never changed."""
    if when is None or not now:
        return dict(now)
    rows = (
        db.query(AuditLog.entity_id, AuditLog.created_at, AuditLog.changes)
        .filter(
            AuditLog.action == AuditAction.status_change,
            AuditLog.entity_type == entity_type,
            AuditLog.entity_id.in_([UUID(i) for i in now]),
        )
        .order_by(AuditLog.created_at)
        .all()
    )
    out = dict(now)
    settled: set[str] = set()
    for entity_id, at, changes in rows:
        key = str(entity_id)
        move = (changes or {}).get("status") or {}
        if at <= when:
            if move.get("new"):
                out[key] = move["new"]
            settled.add(key)
        elif key not in settled:
            # The first move after `when`, with none before it, says where it was.
            if move.get("old"):
                out[key] = move["old"]
            settled.add(key)
    return out


def _collect(snapshot: dict) -> tuple[dict, dict, dict]:
    """Platforms, Emitters and Modes on one side, by id. An Emitter pinned at
    different versions by two Platforms counts at its newest."""
    platforms: dict[str, dict] = {}
    emitters: dict[str, dict] = {}
    for link in snapshot.get("links", []):
        ps = link.get("platform_snapshot") or {}
        pid = link["platform_id"]
        platforms[pid] = {
            "name": link.get("platform_name") or ps.get("name"),
            "version": link.get("platform_version_number"),
            "status": ps.get("status"),
            "emitters": {e["emitter_id"]: e.get("emitter_name") for e in ps.get("links", [])},
        }
        for e in ps.get("links", []):
            eid = e["emitter_id"]
            seen = emitters.get(eid)
            if seen is None:
                emitters[eid] = {
                    "name": e.get("emitter_name"),
                    "versions": {e["emitter_version_number"]},
                    "version": e["emitter_version_number"],
                    "snapshot": e.get("emitter_snapshot") or {},
                    "platforms": [platforms[pid]["name"]],
                }
                continue
            seen["versions"].add(e["emitter_version_number"])
            seen["platforms"].append(platforms[pid]["name"])
            if e["emitter_version_number"] > seen["version"]:
                seen.update(version=e["emitter_version_number"], snapshot=e.get("emitter_snapshot") or {})
    modes: dict[str, dict] = {}
    for eid, e in emitters.items():
        for group in e["snapshot"].get("ew_groups", []):
            for m in group.get("modes", []):
                modes[m["id"]] = {**m, "group_name": group.get("name"), "emitter_id": eid, "emitter_name": e["name"]}
    return platforms, emitters, modes


def _current(db: Session, model, ids: set[str]) -> dict[str, str]:
    if not ids:
        return {}
    return {str(i): s for i, s in db.query(model.id, model.status).filter(model.id.in_([UUID(x) for x in ids]))}


def _change(in_a: bool, in_b: bool, differs: bool) -> str:
    if not in_a:
        return "added"
    if not in_b:
        return "removed"
    return "changed" if differs else "same"


def _side_out(mdf: Mdf, version: int | None, saved_at: datetime | None, mdf_status: str) -> dict:
    return {
        "mdf_id": str(mdf.id),
        "mdf_name": mdf.name,
        "version": version,
        "saved_at": saved_at.isoformat() if saved_at else None,
        "status": mdf_status,
    }


def compare_mdfs(db: Session, a: UUID, b: UUID, a_version: int | None, b_version: int | None) -> dict:
    if a == b and a_version == b_version:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Pick a different version on one side")
    mdf_a, snap_a, when_a = _side(db, a, a_version)
    mdf_b, snap_b, when_b = _side(db, b, b_version)
    pa, ea, ma = _collect(snap_a)
    pb, eb, mb = _collect(snap_b)

    # Statuses as each side stood: from the Audit Log for a saved version, current for now.
    platform_now = _current(db, Platform, set(pa) | set(pb))
    emitter_now = _current(db, Emitter, set(ea) | set(eb))
    for side in (pa, pb):
        for pid, p in side.items():
            platform_now.setdefault(pid, p["status"])
    for side in (ea, eb):
        for eid, e in side.items():
            emitter_now.setdefault(eid, e["snapshot"].get("status"))
    p_status_a = _statuses_at(db, AuditEntityType.platform.value, platform_now, when_a)
    p_status_b = _statuses_at(db, AuditEntityType.platform.value, platform_now, when_b)
    e_status_a = _statuses_at(db, AuditEntityType.emitter.value, emitter_now, when_a)
    e_status_b = _statuses_at(db, AuditEntityType.emitter.value, emitter_now, when_b)
    mdf_status_a = _statuses_at(db, AuditEntityType.mdf.value, {str(mdf_a.id): mdf_a.status}, when_a)[str(mdf_a.id)]
    mdf_status_b = _statuses_at(db, AuditEntityType.mdf.value, {str(mdf_b.id): mdf_b.status}, when_b)[str(mdf_b.id)]

    modes_out = []
    per_emitter: dict[str, dict[str, int]] = {}
    for mid in set(ma) | set(mb):
        old, new = ma.get(mid), mb.get(mid)
        fields = _changed_fields(old, new) if old and new else []
        change = _change(old is not None, new is not None, bool(fields))
        if change == "same":
            continue
        m = new or old
        per_emitter.setdefault(m["emitter_id"], {"added": 0, "removed": 0, "changed": 0})[change] += 1
        modes_out.append(
            {
                "mode_id": mid,
                "name": m["name"],
                "old_name": old["name"] if old and new and old["name"] != new["name"] else None,
                "emitter_id": m["emitter_id"],
                "emitter_name": m["emitter_name"],
                "group_name": m["group_name"],
                "change": change,
                "fields": fields,
                "summary": mode_summary(m),
                "old_summary": mode_summary(old) if change == "changed" and mode_summary(old) != mode_summary(new) else None,
                # Added with its Emitter, rather than to an Emitter already in.
                "new_emitter": change == "added" and m["emitter_id"] not in ea,
            }
        )
    order = {"added": 0, "changed": 1, "removed": 2}
    modes_out.sort(key=lambda m: (m["emitter_name"] or "", order[m["change"]], m["name"]))

    emitters_out = []
    for eid in set(ea) | set(eb):
        old, new = ea.get(eid), eb.get(eid)
        e = new or old
        st_a = e_status_a.get(eid) if old else None
        st_b = e_status_b.get(eid) if new else None
        counts = per_emitter.get(eid, {"added": 0, "removed": 0, "changed": 0})
        differs = bool(old and new and (old["versions"] != new["versions"] or st_a != st_b or any(counts.values())))
        emitters_out.append(
            {
                "emitter_id": eid,
                "name": e["name"],
                "change": _change(old is not None, new is not None, differs),
                "from_versions": sorted(old["versions"]) if old else [],
                "to_versions": sorted(new["versions"]) if new else [],
                "from_status": st_a,
                "to_status": st_b,
                "status_changed": bool(old and new and st_a != st_b),
                "platforms": sorted(set((new or old)["platforms"])),
                "modes_added": counts["added"],
                "modes_removed": counts["removed"],
                "modes_changed": counts["changed"],
            }
        )
    emitters_out.sort(key=lambda e: (e["name"] or "").lower())

    platforms_out = []
    for pid in set(pa) | set(pb):
        old, new = pa.get(pid), pb.get(pid)
        p = new or old
        st_a = p_status_a.get(pid) if old else None
        st_b = p_status_b.get(pid) if new else None
        before = old["emitters"] if old else {}
        after = new["emitters"] if new else {}
        # A Platform new to the MDF brings all its Emitters; one gone takes them all.
        added = sorted(after[k] for k in set(after) - set(before))
        removed = sorted(before[k] for k in set(before) - set(after))
        differs = bool(old and new and (old["version"] != new["version"] or st_a != st_b))
        platforms_out.append(
            {
                "platform_id": pid,
                "name": p["name"],
                "change": _change(old is not None, new is not None, differs),
                "from_version": old["version"] if old else None,
                "to_version": new["version"] if new else None,
                "from_status": st_a,
                "to_status": st_b,
                "status_changed": bool(old and new and st_a != st_b),
                "emitters_added": added,
                "emitters_removed": removed,
                "emitter_count": len(after or before),
            }
        )
    platforms_out.sort(key=lambda p: (p["name"] or "").lower())

    def tally(rows: list[dict]) -> dict[str, int]:
        return {
            "added": sum(r["change"] == "added" for r in rows),
            "removed": sum(r["change"] == "removed" for r in rows),
            "status_changed": sum(r.get("status_changed", False) for r in rows),
        }

    return {
        "a": _side_out(mdf_a, a_version, when_a, mdf_status_a),
        "b": _side_out(mdf_b, b_version, when_b, mdf_status_b),
        "counts": {
            "platforms": tally(platforms_out),
            "emitters": tally(emitters_out),
            "modes": {k: sum(m["change"] == k for m in modes_out) for k in ("added", "removed", "changed")},
        },
        "platforms": platforms_out,
        "emitters": emitters_out,
        "modes": modes_out,
    }
