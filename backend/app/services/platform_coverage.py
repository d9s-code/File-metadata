"""What each Emitter pinned on a Platform (or, through its Platforms, an MDF) covers — its Modes' RF, PRI and PW
ranges as of the pinned version, raw and engineered (± delta), for the
Platform's charts. Modes whose Sources were all rejected are left out, as in
the export."""

from uuid import UUID

from sqlalchemy.orm import Session

from app.models.emitter import Emitter
from app.models.emitter_version import EmitterVersion
from app.models.mdf import MdfPlatformLink
from app.models.platform import Platform, PlatformEmitterLink, PlatformVersion
from app.services.delta import apply_delta
from app.services.frametime_service import effective_frametime_us


def _span(lo, hi):
    if lo is None or hi is None:
        return None
    lo, hi = float(lo), float(hi)
    return [min(lo, hi), max(lo, hi)]


def _planner(
    mode: dict,
    line: dict,
    group: dict | None,
    operational: dict | None = None,
    scans: dict | None = None,
    timeline: dict | None = None,
) -> dict:
    """What the dwell planner needs to know of a Mode: the longest gap
    between its pulses (µs — a Fixed PRI's longest, with its delta and
    jitter; a stagger's longest step), a stagger's steps and longest frame
    time, its EW Group's scan period (s, with its delta), priority, and how
    many intercepts it takes to confirm — and its scan (its own, else its
    operational mode's or the nearest one above it with one), whose
    illumination time and revisit the planner works out."""
    pri_type = mode.get("pri_type")
    longest = frame = mean = None
    steps = 0
    if pri_type == "fixed":
        hi = apply_delta(line.get("pri_min_us"), line.get("pri_max_us"), line.get("pri_delta"))[1]
        if hi is not None:
            longest = float(hi) + float(line.get("jitter_max_us") or 0) + float(line.get("jitter_delta") or 0)
        if line.get("pri_min_us") is not None and line.get("pri_max_us") is not None:
            mean = (float(line["pri_min_us"]) + float(line["pri_max_us"])) / 2
    elif pri_type == "stagger":
        values = [float(v) for v in line.get("pri_stagger_values_us") or []]
        steps = len(values)
        longest = max(values) if values else None
        mean = sum(values) / len(values) if values else None
        ft = effective_frametime_us(line.get("pri_stagger_values_us"), line.get("explicit_frame_time_us"))
        if ft is not None:
            frame = float(apply_delta(ft, ft, line.get("frame_time_delta_us"))[1])
    group = group or {}
    group_scan = _span(*apply_delta(group.get("scan_min"), group.get("scan_max"), group.get("scan_delta")))
    scans = scans or {}
    operational = operational or {}
    own = scans.get(mode.get("scan_id") or "")
    inherited = scans.get(operational.get("scan_id") or "")
    scan = own or inherited
    def clamp(span):
        return [max(span[0], 0.0), span[1]] if span else None

    return {
        "longest_interval_us": longest,
        # Its average gap between pulses, µs: how long an ESA dwell of N pulses lasts.
        "mean_interval_us": mean,
        "stagger_steps": steps,
        "frame_us": frame,
        # Its scan, as the Emitter has it (pattern, values, beamwidths), and
        # where it comes from: the Mode's own or an operational mode's.
        "scan": scan,
        "scan_from": "mode" if own else "operational" if inherited else None,
        "scan_from_operational": operational.get("scan_from") if not own and inherited else None,
        # Without one: the EW Group's overall range (with its delta), s.
        "scan_s": clamp(group_scan),
        "group_scan_s": clamp(group_scan),
        "priority": group.get("threat_priority"),
        "confirmation_quantity": mode.get("confirmation_quantity"),
        "group_name": group.get("name"),
        # The radar's operational mode it's transmitted in ("TRACK › Track 2").
        "operational_mode": operational.get("path"),
        # Its gaps between pulses, µs, as the planner counts them (a Fixed PRI's longest; a stagger's steps).
        "steps_us": _pulses(mode)["steps_us"],
        # Sent in pulse groups: this many pulses, then off this long (ms).
        "group_pulses": mode.get("group_pulses"),
        "group_off_ms": mode.get("group_off_ms"),
        # On/off periods (s) of its operational mode (or the nearest above it with some), and which one.
        "on_off_s": operational.get("on_off_s"),
        "on_off_from": operational.get("on_off_from"),
        # The timeline it's sent in, when an operational mode sequences it:
        # each step with its pulses (own: this Mode's steps).
        "timeline": timeline,
    }


def _mode_ranges(
    mode: dict,
    group: dict | None = None,
    operational: dict | None = None,
    scans: dict | None = None,
    timeline: dict | None = None,
) -> dict | None:
    line = mode.get("line")
    if not line:
        return None
    pri_type = mode.get("pri_type")
    rf_raw = _span(line.get("rf_min_mhz"), line.get("rf_max_mhz"))
    if rf_raw is None:
        return None
    out = {
        "id": str(mode["id"]) if mode.get("id") else None,
        "name": mode["name"],
        "pri_type": pri_type,
        "rf_raw": rf_raw,
        "rf": _span(*apply_delta(rf_raw[0], rf_raw[1], line.get("rf_delta"))),
        "pri_raw": None,
        "pri": None,
        "pw_raw": None,
        "pw": None,
        "planner": _planner(mode, line, group, operational, scans, timeline),
    }
    if pri_type != "cw":
        pw_raw = _span(line.get("pw_min_us"), line.get("pw_max_us"))
        if pw_raw:
            out["pw_raw"] = pw_raw
            out["pw"] = _span(*apply_delta(pw_raw[0], pw_raw[1], line.get("pw_delta")))
    if pri_type == "fixed":
        pri_raw = _span(line.get("pri_min_us"), line.get("pri_max_us"))
        if pri_raw:
            out["pri_raw"] = pri_raw
            out["pri"] = _span(*apply_delta(pri_raw[0], pri_raw[1], line.get("pri_delta")))
    elif pri_type == "stagger":
        frame = effective_frametime_us(line.get("pri_stagger_values_us"), line.get("explicit_frame_time_us"))
        if frame is not None:
            out["pri_raw"] = [frame, frame]
            out["pri"] = _span(*apply_delta(frame, frame, line.get("frame_time_delta_us")))
    return out


def _operational_effective(rows: list[dict]) -> dict[str, dict]:
    """Each operational mode with its path ("TRACK › Track 2"), the scan it
    gives its Modes and its on/off periods: its own, else the nearest one
    above it with one (and that one's name)."""
    by_id = {o["id"]: o for o in rows}
    out = {}
    for op_id in by_id:
        names, scan, source, on_off, on_off_from, chain, current, seen = [], None, None, None, None, [], op_id, set()
        while current and current in by_id and current not in seen:
            seen.add(current)
            row = by_id[current]
            names.append(row["name"])
            chain.append(current)
            if scan is None and row.get("scan_id"):
                scan, source = row["scan_id"], row["name"]
            emission = row.get("emission") or {}
            if on_off is None and emission.get("on_s") is not None:
                on_off, on_off_from = [float(emission["on_s"]), float(emission["off_s"])], row["name"]
            current = row.get("parent_id")
        out[op_id] = {
            "path": " › ".join(reversed(names)),
            "scan_id": scan,
            "scan_from": source,
            "on_off_s": on_off,
            "on_off_from": on_off_from,
            "chain": chain,
        }
    return out


def _pulses(mode: dict) -> dict:
    """A Mode's pulses as the planner draws them: a Fixed PRI's longest gap
    (with its delta and jitter), a stagger's steps (µs); CW none."""
    line = mode.get("line") or {}
    if mode.get("pri_type") == "fixed":
        hi = apply_delta(line.get("pri_min_us"), line.get("pri_max_us"), line.get("pri_delta"))[1]
        if hi is not None:
            return {"steps_us": [float(hi) + float(line.get("jitter_max_us") or 0) + float(line.get("jitter_delta") or 0)]}
    elif mode.get("pri_type") == "stagger":
        steps = [float(v) for v in line.get("pri_stagger_values_us") or []]
        if steps:
            return {"steps_us": steps}
    return {"steps_us": []}


def _timelines(rows: list[dict], modes: dict[str, dict], effective: dict[str, dict]) -> dict[str, dict]:
    """For each Mode sequenced in an operational mode's timeline: that
    timeline, each step resolved (its Mode's name and pulses; own: the
    Mode's) — the one of its own operational mode or the nearest above it
    that names it, else any that does."""
    by_id = {o["id"]: o for o in rows}

    def resolved(op_id: str, mode_id: str) -> dict:
        steps = []
        for item in (by_id[op_id].get("emission") or {}).get("timeline") or []:
            if item.get("kind") == "off":
                steps.append({"kind": "off", "ms": float(item["ms"])})
                continue
            m = modes.get(item.get("mode_id") or "")
            if m is None:
                continue  # its Mode deleted since: the step leaves out
            steps.append(
                {
                    "kind": "group",
                    "mode_name": m["name"],
                    "own": item["mode_id"] == mode_id,
                    "pulses": item.get("pulses"),
                    "ms": float(item["ms"]) if item.get("ms") is not None else None,
                    **_pulses(m),
                }
            )
        return {"operational_mode": by_id[op_id]["name"], "steps": steps}

    naming: dict[str, list[str]] = {}
    for o in rows:
        for item in (o.get("emission") or {}).get("timeline") or []:
            if item.get("mode_id"):
                naming.setdefault(item["mode_id"], [])
                if o["id"] not in naming[item["mode_id"]]:
                    naming[item["mode_id"]].append(o["id"])
    out = {}
    for mode_id, op_ids in naming.items():
        if mode_id not in modes:
            continue
        chain = effective.get(modes[mode_id].get("operational_mode_id") or "", {}).get("chain", [])
        op_id = next((c for c in chain if c in op_ids), op_ids[0])
        out[mode_id] = resolved(op_id, mode_id)
    return out


def emitter_coverage(snapshot: dict, *, emitter_id, emitter_name: str, designation, version_number: int) -> dict:
    """One Emitter version's coverage from its snapshot."""
    operational = _operational_effective(snapshot.get("operational_modes", []))
    scans = {x["id"]: x for x in snapshot.get("scans", [])}
    all_modes = {m["id"]: m for g in snapshot.get("ew_groups", []) for m in g.get("modes", []) if m.get("id")}
    timelines = _timelines(snapshot.get("operational_modes", []), all_modes, operational)
    modes = [
        ranges
        for group in snapshot.get("ew_groups", [])
        for mode in group.get("modes", [])
        if (ranges := _mode_ranges(
                mode, group, operational.get(mode.get("operational_mode_id") or ""), scans, timelines.get(mode.get("id") or "")
            )) is not None
    ]
    return {
        "emitter_id": emitter_id,
        "emitter_name": emitter_name,
        "designation": designation,
        "version_number": version_number,
        # For the dwell planner: how long its beam lights up a Platform (ms), if set.
        "illumination_time_ms": snapshot.get("illumination_time_ms"),
        "modes": modes,
    }


def _by_designation(entries: list[dict]) -> list[dict]:
    return sorted(entries, key=lambda e: ((e["designation"] or "\uffff").lower(), e["emitter_name"].lower()))


def platform_coverage(db: Session, platform_id: UUID) -> list[dict]:
    links = (
        db.query(PlatformEmitterLink, EmitterVersion, Emitter)
        .join(EmitterVersion, PlatformEmitterLink.emitter_version_id == EmitterVersion.id)
        .join(Emitter, PlatformEmitterLink.emitter_id == Emitter.id)
        .filter(PlatformEmitterLink.platform_id == platform_id)
        .all()
    )
    return _by_designation(
        [
            emitter_coverage(
                version.snapshot,
                emitter_id=emitter.id,
                emitter_name=emitter.name,
                designation=emitter.designation,
                version_number=version.version_number,
            )
            for _link, version, emitter in links
        ]
    )


def mdf_coverage(db: Session, mdf_id: UUID) -> list[dict]:
    """Each Platform version pinned on an MDF, with what its pinned Emitter
    versions cover — as recorded in that Platform version."""
    links = (
        db.query(MdfPlatformLink, PlatformVersion, Platform)
        .join(PlatformVersion, MdfPlatformLink.platform_version_id == PlatformVersion.id)
        .join(Platform, MdfPlatformLink.platform_id == Platform.id)
        .filter(MdfPlatformLink.mdf_id == mdf_id)
        .all()
    )
    out = []
    for _link, version, platform in links:
        emitters = [
            emitter_coverage(
                el["emitter_snapshot"],
                emitter_id=el["emitter_id"],
                emitter_name=el["emitter_name"],
                designation=el["emitter_snapshot"].get("designation"),
                version_number=el.get("emitter_version_number") or 0,
            )
            for el in version.snapshot.get("links", [])
        ]
        out.append(
            {
                "platform_id": platform.id,
                "platform_name": platform.name,
                "version_number": version.version_number,
                "version_label": version.version_label,
                "emitters": _by_designation(emitters),
            }
        )
    out.sort(key=lambda p: p["platform_name"].lower())
    _add_emitter_state(db, [e for p in out for e in p["emitters"]])
    return out


def _add_emitter_state(db: Session, emitters: list[dict]) -> None:
    """Each pinned Emitter's status now and its latest saved version — so a
    pin behind it can be flagged."""
    from sqlalchemy import func

    ids = {UUID(str(e["emitter_id"])) for e in emitters if e.get("emitter_id")}
    if not ids:
        return
    status = dict(db.query(Emitter.id, Emitter.status).filter(Emitter.id.in_(ids)).all())
    latest = dict(
        db.query(EmitterVersion.emitter_id, func.max(EmitterVersion.version_number))
        .filter(EmitterVersion.emitter_id.in_(ids))
        .group_by(EmitterVersion.emitter_id)
        .all()
    )
    for e in emitters:
        eid = UUID(str(e["emitter_id"])) if e.get("emitter_id") else None
        st = status.get(eid)
        e["status"] = getattr(st, "value", st)
        e["latest_version_number"] = latest.get(eid)
