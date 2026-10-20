"""Which of the Elements in an Emitter's Sources its Modes cover.

Each distinct Element (as on All Sources) is checked against the Modes'
engineered ranges (their values with the margin) for its parameter:

- RF and PW: the Modes' RF / PW ranges.
- PRI: a fixed or jittered PRI against the Modes' PRI ranges, and against a
  Stagger Mode's steps (a PRI used as one of its steps is covered by it); a
  stagger Element against Stagger Modes' sequences, step by step.
- Scan: the EW Groups' scan ranges.

An Element is covered when the ranges together hold all of it (a range of
values, or every step of a stagger), partly covered when they hold some of
it, and not covered otherwise. What covers it is listed, as are the ranges
themselves, for the chart."""

from uuid import UUID

from sqlalchemy.orm import Session

from app.core.enums import PriType
from app.models.ew_group import EwGroup
from app.models.mode import Mode
from app.services.element_overview import element_overview

# Floating-point slack when comparing values written with up to 4 decimals.
EPS = 1e-6


def _num(v) -> float | None:
    return None if v is None else float(v)


def _with_margin(lo, hi, delta) -> tuple[float, float] | None:
    lo, hi = _num(lo), _num(hi)
    if lo is None and hi is None:
        return None
    lo = hi if lo is None else lo
    hi = lo if hi is None else hi
    d = _num(delta) or 0.0
    return (min(lo, hi) - d, max(lo, hi) + d)


def _cover(lo: float, hi: float, ranges: list[dict]) -> tuple[str, list[dict]]:
    """How much of [lo, hi] the ranges hold together, and which ranges touch it."""
    touching = [r for r in ranges if r["min"] <= hi + EPS and r["max"] >= lo - EPS]
    if not touching:
        return "not_covered", []
    # Walk the touching ranges in order: covered if they leave no gap in [lo, hi].
    reach = lo
    for r in sorted(touching, key=lambda r: r["min"]):
        if r["min"] > reach + EPS:
            break
        reach = max(reach, r["max"])
    return ("covered" if reach >= hi - EPS else "partial"), touching


def _who(ranges: list[dict]) -> list[dict]:
    seen: dict[str, dict] = {}
    for r in ranges:
        seen.setdefault(r["id"], {"id": r["id"], "name": r["name"], "kind": r["kind"]})
    return list(seen.values())


def element_coverage(db: Session, emitter_id: UUID) -> dict:
    groups = db.query(EwGroup).filter(EwGroup.emitter_id == emitter_id).order_by(EwGroup.sort_order).all()
    modes = (
        db.query(Mode).join(EwGroup, Mode.ew_group_id == EwGroup.id).filter(EwGroup.emitter_id == emitter_id).all()
    )

    ranges: dict[str, list[dict]] = {"rf": [], "pri": [], "pw": [], "scan": []}
    staggers: list[dict] = []
    for mode in modes:
        line = mode.line
        if line is None:
            continue
        base = {"id": str(mode.id), "name": mode.name, "kind": "mode", "group": mode.ew_group.name}
        rf = _with_margin(line.rf_min_mhz, line.rf_max_mhz, line.rf_delta)
        if rf:
            ranges["rf"].append({**base, "min": rf[0], "max": rf[1]})
        pw = _with_margin(line.pw_min_us, line.pw_max_us, line.pw_delta)
        if pw:
            ranges["pw"].append({**base, "min": pw[0], "max": pw[1]})
        if mode.pri_type == PriType.stagger and line.pri_stagger_values_us:
            delta = _num(line.pri_delta) or 0.0
            steps = [float(v) for v in line.pri_stagger_values_us]
            staggers.append({**base, "steps": steps, "delta": delta})
            # Each step is a narrow PRI range of its own, so the chart shows it too.
            for v in steps:
                ranges["pri"].append({**base, "min": v - delta, "max": v + delta, "step": True})
        else:
            pri = _with_margin(line.pri_min_us, line.pri_max_us, line.pri_delta)
            if pri:
                ranges["pri"].append({**base, "min": pri[0], "max": pri[1]})
    for group in groups:
        scan = _with_margin(group.scan_min, group.scan_max, group.scan_delta)
        if scan:
            ranges["scan"].append(
                {"id": str(group.id), "name": group.name, "kind": "ew_group", "group": group.name,
                 "min": scan[0], "max": scan[1]}
            )

    rows = []
    for row in element_overview(db, emitter_id):
        kind = row["element_type"]
        stagger = row["stagger_values"]
        if kind == "pri" and stagger:
            # Every step of the Element must be a step of one Stagger Mode.
            best, by = 0, []
            for s in staggers:
                hit = sum(1 for v in stagger if any(abs(v - w) <= s["delta"] + EPS for w in s["steps"]))
                if hit:
                    by.append(s)
                best = max(best, hit)
            status = "covered" if best == len(stagger) else "partial" if best else "not_covered"
            covered_by = _who(by)
        elif row["value_min"] is None and row["value_max"] is None:
            status, covered_by = "not_covered", []
        else:
            lo = row["value_min"] if row["value_min"] is not None else row["value_max"]
            hi = row["value_max"] if row["value_max"] is not None else row["value_min"]
            lo, hi = min(lo, hi), max(lo, hi)
            own = [r for r in ranges.get(kind, []) if not r.get("step")]
            status, touching = _cover(lo, hi, own)
            if kind == "pri" and status != "covered":
                # A Stagger Mode built from it uses its mean as a step.
                mean = (lo + hi) / 2
                used = [s for s in staggers if any(abs(mean - w) <= s["delta"] + EPS for w in s["steps"])]
                if used:
                    status, touching = "covered", touching + used
            covered_by = _who(touching)
        rows.append({**row, "coverage": status, "covered_by": covered_by})

    summary = {
        kind: {
            "covered": sum(1 for r in rows if r["element_type"] == kind and r["coverage"] == "covered"),
            "partial": sum(1 for r in rows if r["element_type"] == kind and r["coverage"] == "partial"),
            "not_covered": sum(1 for r in rows if r["element_type"] == kind and r["coverage"] == "not_covered"),
        }
        for kind in ("rf", "pri", "pw", "scan")
    }
    return {"elements": rows, "ranges": ranges, "summary": summary}
