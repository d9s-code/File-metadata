"""Which of the Elements in an Emitter's Sources its Modes cover.

Each distinct Element (as on All Sources), and each of the Sources'
sequences, is checked against the Modes' engineered ranges (their values
with the margin) for its parameter:

- RF and PW: the Modes' RF / PW ranges.
- PRI: a fixed or jittered PRI against the Modes' PRI ranges, and against a
  Stagger Mode's steps (a PRI used as one of its steps is covered by it).
- A stagger — a stagger Element, or a sequence with PRI steps (its PRI steps
  in step order, a range at its mean, as generating Modes from it makes the
  train) — against the Stagger Modes' trains, in order: covered by a Stagger
  Mode with the same steps in the same order (starting at any step — a train
  repeats); partly when one has all its steps in another order or among
  others, or some of them. A sequence's RF and PW must also sit in that
  Mode's RF and PW.
- A sequence without PRI steps: each step's RF and PW against the Modes'.
- Scan: the EW Groups' scan ranges.

An Element is covered when the ranges together hold all of it, partly
covered when they hold some of it, and not covered otherwise; a note says
why it's only partly covered. What covers it is listed, as are the ranges
themselves, for the chart."""

from uuid import UUID

from sqlalchemy.orm import Session

from app.core.enums import PriType
from app.models.ew_group import EwGroup
from app.models.mode import Mode
from app.models.parameter_sequence import ParameterSequence
from app.models.source import Source
from app.services.cartesian_service import _span, _step_range
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


def _same(a: float, b: float, delta: float) -> bool:
    return abs(a - b) <= delta + EPS


def _in_order(train: list[float], steps: list[float], delta: float) -> bool:
    """The same steps in the same order, starting at any of them."""
    n = len(steps)
    if len(train) != n:
        return False
    return any(all(_same(train[i], steps[(i + r) % n], delta) for i in range(n)) for r in range(n))


def _found(train: list[float], steps: list[float], delta: float) -> int:
    """How many of the train's steps the Mode has (each of its steps used once)."""
    left = list(steps)
    hits = 0
    for v in train:
        for i, w in enumerate(left):
            if _same(v, w, delta):
                hits += 1
                del left[i]
                break
    return hits


def _fits(span: tuple[float, float] | None, mode_range: tuple[float, float] | None) -> bool:
    if span is None:
        return True
    return mode_range is not None and mode_range[0] <= span[0] + EPS and span[1] <= mode_range[1] + EPS


def _values(train: list[float]) -> str:
    return ", ".join(f"{v:g}" for v in train)


def _stagger_cover(train: list[float], staggers: list[dict], rf=None, pw=None) -> tuple[str, list[dict], str | None]:
    """A stagger train against the Stagger Modes, in order (see the module's
    docstring); `rf` / `pw`: the span a sequence's steps give, to fit too."""
    if not staggers:
        return "not_covered", [], "No Stagger Mode"
    exact = [s for s in staggers if _in_order(train, s["steps"], s["delta"])]
    whole = [s for s in exact if _fits(rf, s["rf"]) and _fits(pw, s["pw"])]
    if whole:
        return "covered", whole, None
    if exact:
        s = exact[0]
        off = [name for name, span, own in (("RF", rf, s["rf"]), ("PW", pw, s["pw"])) if not _fits(span, own)]
        return "partial", exact, f"Same steps in the same order as {s['name']}, but its {' and '.join(off)} doesn't hold this one's"
    counts = [(s, _found(train, s["steps"], s["delta"])) for s in staggers]
    best = max(n for _, n in counts)
    if best == 0:
        return "not_covered", [], "No Stagger Mode has any of its steps"
    near = [s for s, n in counts if n == best]
    s = near[0]
    if best == len(train):
        how = "in another order" if len(s["steps"]) == len(train) else f"among its {len(s['steps'])} steps ({_values(s['steps'])})"
        return "partial", near, f"{s['name']} has all its steps, {how}"
    return "partial", near, f"{s['name']} has {best} of its {len(train)} steps"


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
            staggers.append({**base, "steps": steps, "delta": delta, "rf": rf, "pw": pw})
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
        note = None
        if kind == "pri" and stagger:
            status, by, note = _stagger_cover(stagger, staggers)
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
            if status == "partial":
                note = "Runs past the " + ("EW Groups' scan ranges" if kind == "scan" else "Modes' ranges")
        rows.append({**row, "coverage": status, "covered_by": covered_by, "note": note, "sequence": None})

    rows += _sequence_rows(db, emitter_id, ranges, staggers)

    summary = {
        kind: {
            "covered": sum(1 for r in rows if r["element_type"] == kind and r["coverage"] == "covered"),
            "partial": sum(1 for r in rows if r["element_type"] == kind and r["coverage"] == "partial"),
            "not_covered": sum(1 for r in rows if r["element_type"] == kind and r["coverage"] == "not_covered"),
        }
        for kind in ("rf", "pri", "pw", "scan")
    }
    return {"elements": rows, "ranges": ranges, "summary": summary}


def _sequence_rows(db: Session, emitter_id: UUID, ranges: dict, staggers: list[dict]) -> list[dict]:
    """The Sources' sequences: one with PRI steps as a stagger train (one PRI
    row); one without, a row per parameter its steps set (RF, PW)."""
    out = []
    sequences = (
        db.query(ParameterSequence, Source)
        .join(Source, ParameterSequence.source_id == Source.id)
        .filter(Source.emitter_id == emitter_id)
        .order_by(Source.name, ParameterSequence.sort_order)
        .all()
    )
    for seq, source in sequences:
        steps = sorted(seq.steps or [], key=lambda st: st.get("order", 0))

        def spans(point, lo, hi):
            return [r for r in (_step_range(st, point, lo, hi) for st in steps) if r is not None]

        pri, rf, pw = spans("pri_us", "pri_min_us", "pri_max_us"), spans("rf_mhz", "rf_min_mhz", "rf_max_mhz"), spans(
            "pw_us", "pw_min_us", "pw_max_us"
        )
        base = {
            "value_min": None,
            "value_max": None,
            "stagger_values": None,
            "jitter_min": None,
            "jitter_max": None,
            "occurrences": [
                {"element_id": seq.id, "source_id": source.id, "source_name": source.name,
                 "variant": seq.variant.value if seq.variant else None, "label": seq.label,
                 "delta": None}
            ],
            "sequence": {"id": str(seq.id), "label": seq.label or "Sequence", "steps": len(steps)},
        }
        if pri:
            train = [(lo + hi) / 2 for lo, hi in pri]
            status, by, note = _stagger_cover(train, staggers, rf=_span(rf), pw=_span(pw))
            out.append({**base, "element_type": "pri", "stagger_values": train, "coverage": status,
                        "covered_by": _who(by), "note": note})
            continue
        for kind, values in (("rf", rf), ("pw", pw)):
            if not values:
                continue
            results = [_cover(lo, hi, ranges[kind]) for lo, hi in values]
            done = sum(1 for status, _ in results if status == "covered")
            status = "covered" if done == len(results) else "not_covered" if all(
                st == "not_covered" for st, _ in results
            ) else "partial"
            touching = [r for _, t in results for r in t]
            out.append({**base, "element_type": kind, "stagger_values": [(lo + hi) / 2 for lo, hi in values],
                        "coverage": status, "covered_by": _who(touching),
                        "note": None if status != "partial" else f"{done} of its {len(results)} steps are covered"})
    return out
