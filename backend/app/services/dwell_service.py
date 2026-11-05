"""Dwell Strategies and dwell files as snapshots (what a saved version keeps,
and what a file's XML is written from), and the readable changes between
two versions."""

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.dwell import DwellFile, DwellFileVersion, DwellStrategy, DwellStrategyVersion, MdfDwellLink
from app.services.dwell_xml import build_dwell_xml, fmt
from app.services.emitter_diff_service import _entry


def strategy_snapshot(strategy: DwellStrategy) -> dict:
    return {
        "name": strategy.name,
        "platform_ids": [str(pid) for pid in strategy.platform_ids],
        "platform_names": strategy.platform_names,
        "description": strategy.description,
        "manual_collect_time_ms": strategy.manual_collect_time_ms,
        "dwells": list(strategy.dwells or []),
        "rapid_df": strategy.rapid_df,
        "split_mode": strategy.split_mode,
    }


def file_snapshot(dwell_file: DwellFile) -> dict:
    """The file's settings and, in order, each pinned Strategy version — its
    whole snapshot, so the file can be written from this alone. (Which MDFs
    use it isn't part of it: they pin it, not the other way round.)"""
    return {
        "name": dwell_file.name,
        "timeout": dwell_file.timeout,
        "setup_time": dwell_file.setup_time,
        "notes": dwell_file.notes,
        "strategies": [
            {
                "strategy_id": str(link.strategy_id),
                "strategy_version_id": str(link.strategy_version_id),
                "strategy_version_number": link.strategy_version.version_number,
                "snapshot": link.strategy_version.snapshot,
            }
            for link in dwell_file.links
        ],
    }


#: Kept in versions saved while a file belonged to one MDF; not part of what it is.
_NOT_CONTENT = ("mdf_id", "mdf_name")


def file_changed(saved: DwellFileVersion | None, dwell_file: DwellFile) -> bool:
    """Whether the file differs from this saved version of it (or was never saved)."""
    if saved is None:
        return True
    old = {k: v for k, v in saved.snapshot.items() if k not in _NOT_CONTENT}
    return old != file_snapshot(dwell_file)


def latest_strategy_version(db: Session, strategy_id) -> DwellStrategyVersion | None:
    return (
        db.query(DwellStrategyVersion)
        .filter(DwellStrategyVersion.strategy_id == strategy_id)
        .order_by(DwellStrategyVersion.version_number.desc())
        .first()
    )


def latest_file_version(db: Session, file_id) -> DwellFileVersion | None:
    return (
        db.query(DwellFileVersion)
        .filter(DwellFileVersion.dwell_file_id == file_id)
        .order_by(DwellFileVersion.version_number.desc())
        .first()
    )


def _dwell_text(d: dict) -> str:
    return f"{fmt(d['freq_mhz'])} MHz · dwell {fmt(d['dwell_time_ms'])} ms · collect {fmt(d['collect_time_ms'])} ms"


def platforms_text(snapshot: dict) -> str:
    """A snapshot's Platforms as a line ("Default dwell" when none) — read
    from versions saved before a Strategy could cover several, too."""
    names = snapshot.get("platform_names")
    if names is None:
        names = [snapshot["platform_name"]] if snapshot.get("platform_name") else []
    return ", ".join(names) if names else "Default dwell (no Platform)"


def strategy_diff(old: dict, new: dict) -> list[dict]:
    """What changed in a Strategy: its fields, then its dwells by place."""
    entries: list[dict] = []
    for key, label in (("name", "Name"), ("description", "Description")):
        if old.get(key) != new.get(key):
            entries.append(_entry("Strategy", label, "changed", old.get(key), new.get(key)))
    if platforms_text(old) != platforms_text(new):
        entries.append(_entry("Strategy", "Platforms", "changed", platforms_text(old), platforms_text(new)))
    if old.get("manual_collect_time_ms") != new.get("manual_collect_time_ms"):
        entries.append(
            _entry(
                "Strategy",
                "Manual collect time (ms)",
                "changed",
                fmt(old["manual_collect_time_ms"]),
                fmt(new["manual_collect_time_ms"]),
            )
        )
    before, after = old.get("dwells") or [], new.get("dwells") or []
    for i in range(max(len(before), len(after))):
        scope = f"Dwell {i + 1}"
        if i >= len(before):
            entries.append(_entry(scope, "Added", "added", new_value=_dwell_text(after[i])))
        elif i >= len(after):
            entries.append(_entry(scope, "Removed", "removed", old_value=_dwell_text(before[i])))
        elif before[i] != after[i]:
            entries.append(_entry(scope, "Changed", "changed", _dwell_text(before[i]), _dwell_text(after[i])))
    for key, label in (("rapid_df", "RapidDF"), ("split_mode", "Split Mode")):
        if old.get(key) != new.get(key):
            entries.append(_entry("Strategy", label, "changed", str(old.get(key)), str(new.get(key))))
    return entries


def file_diff(old: dict, new: dict) -> list[dict]:
    """What changed in a dwell file: its settings, and which Strategy
    versions it pins (added, removed, repinned, moved)."""
    entries: list[dict] = []
    for key, label in (("name", "Name"), ("mdf_name", "MDF"), ("notes", "Notes")):
        # Older versions named the one MDF a file was for; compared only between two of those.
        if key == "mdf_name" and not (key in old and key in new):
            continue
        if old.get(key) != new.get(key):
            entries.append(_entry("Dwell file", label, "changed", old.get(key), new.get(key)))
    for key, label in (("timeout", "Timeout"), ("setup_time", "Setup time")):
        if old.get(key) != new.get(key):
            entries.append(_entry("Dwell file", label, "changed", fmt(old[key]), fmt(new[key])))

    def by_id(snapshot):
        return {s["strategy_id"]: s for s in snapshot.get("strategies", [])}

    def name(s):
        return f"Strategy '{s['snapshot']['name']}' ({platforms_text(s['snapshot'])})"

    before, after = by_id(old), by_id(new)
    for sid, s in after.items():
        if sid not in before:
            entries.append(_entry(name(s), "Added", "added", new_value=f"At its v{s['strategy_version_number']}"))
        elif before[sid]["strategy_version_number"] != s["strategy_version_number"]:
            entries.append(
                _entry(
                    name(s),
                    "Pinned version",
                    "changed",
                    f"v{before[sid]['strategy_version_number']}",
                    f"v{s['strategy_version_number']}",
                )
            )
    for sid, s in before.items():
        if sid not in after:
            entries.append(_entry(name(s), "Removed", "removed", old_value=f"Was at its v{s['strategy_version_number']}"))
    order_before = [sid for sid in before if sid in after]
    order_after = [sid for sid in after if sid in before]
    if order_before != order_after:
        entries.append(_entry("Dwell file", "Order of the Strategies", "changed", "", "Changed"))
    return entries


def commit_file(db: Session, dwell_file: DwellFile, summary: str | None, user_id) -> DwellFileVersion:
    """Saves the file as it is now as its next version."""
    db.flush()
    db.refresh(dwell_file)
    number = (
        db.query(func.max(DwellFileVersion.version_number)).filter(DwellFileVersion.dwell_file_id == dwell_file.id).scalar()
        or 0
    ) + 1
    version = DwellFileVersion(
        dwell_file_id=dwell_file.id,
        version_number=number,
        snapshot=file_snapshot(dwell_file),
        change_summary=summary,
        created_by=user_id,
    )
    db.add(version)
    db.flush()
    return version


def mdf_dwell_links(db: Session, mdf_id) -> list[MdfDwellLink]:
    """The dwell files an MDF pins, by name."""
    links = db.query(MdfDwellLink).filter(MdfDwellLink.mdf_id == mdf_id).all()
    return sorted(links, key=lambda link: link.dwell_file.name.lower())


def mdf_dwell_pins(db: Session, mdf_id) -> list[dict]:
    """What an MDF version keeps of its dwell files: the version of each that
    it pins, whole, so the version's export is written from it alone."""
    return [
        {
            "dwell_file_id": str(link.dwell_file_id),
            "name": link.dwell_file.name,
            "version_id": str(link.dwell_file_version_id),
            "version_number": link.version.version_number,
            "snapshot": {k: v for k, v in link.version.snapshot.items() if k not in _NOT_CONTENT},
        }
        for link in mdf_dwell_links(db, mdf_id)
    ]


def mdf_dwell_files(db: Session, mdf_id, mdf_snapshot: dict | None = None) -> dict[str, bytes]:
    """An MDF's dwell files for its export, by name: the versions an MDF
    version recorded — or, for one saved before MDF versions kept them (or
    no version given), each file's latest saved version."""
    if mdf_snapshot is not None and "dwell_files" in mdf_snapshot:
        return {d["name"]: build_dwell_xml(d["snapshot"]) for d in mdf_snapshot["dwell_files"]}
    return {d["name"]: build_dwell_xml(d["snapshot"]) for d in mdf_dwell_pins(db, mdf_id)}
