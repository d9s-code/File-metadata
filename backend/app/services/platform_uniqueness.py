"""Platform confidence (experimental), part 1: what in an MDF is unique to
one Platform.

The building blocks for telling which Platform was intercepted — which
Emitters, Modes and parameters only one Platform of the MDF has. Worked out
from the MDF's latest saved version (the Platform versions it pins, and the
Emitter versions those pin), with the ambiguity check's own overlap rules:
each range widened by its ± delta, a Fixed Mode's jitter, a Stagger's steps
(± the step tolerance) or frame time, and a different PRI type telling two
Modes apart outright.

- An Emitter is **unique** when only this Platform pins it, **shared**
  otherwise (whatever versions the Platforms pin).
- A unique Emitter's Mode has a **unique parameter set** when no Mode on any
  other Platform could be taken for it — the same test as the ambiguity
  check: overlapping in RF, PW and PRI (and jitter) at once, same PRI type.
- A **unique parameter** (RF, PRI, PW, Scan) is one no other Platform's Mode
  overlaps on its own. A Mode can have a unique set without any unique
  parameter: then the combination is what's unique.
- A **unique pair** is two shared Emitters no other Platform has together.
- A Platform whose every Emitter another Platform also has can't be told
  from that one by what's heard.

Nothing here is stored; it's information for writing confidence rules."""

from collections import defaultdict
from dataclasses import dataclass, field
from itertools import combinations

from app.services.ambiguity_service import (
    DEFAULT_TOLERANCE,
    FlatModeLine,
    _pri_and_jitter,
    _range_overlap_pct,
    compared_line,
)
from app.services.delta import apply_delta

# How many overlapping Modes to list for one that isn't unique.
OVERLAPS_SHOWN = 5
# How many unique pairs to list for one Platform.
PAIRS_SHOWN = 20


@dataclass
class _Mode:
    flat: FlatModeLine
    line: dict  # as compared (deltas applied)
    scan: tuple[float, float] | None
    ew_group_name: str


@dataclass
class _Platform:
    id: str
    name: str
    version_label: str | None
    emitters: dict[str, dict] = field(default_factory=dict)  # emitter id -> link
    modes: list[_Mode] = field(default_factory=list)


def _span(lo, hi) -> tuple[float, float] | None:
    if lo is None and hi is None:
        return None
    lo = hi if lo is None else lo
    hi = lo if hi is None else hi
    return float(min(lo, hi)), float(max(lo, hi))


def _overlaps(a: tuple[float, float] | None, b: tuple[float, float] | None) -> bool:
    """Whether two ranges share anything; a missing one can't tell them apart."""
    if a is None or b is None:
        return True
    return _range_overlap_pct(a[0], a[1], b[0], b[1]) > 0


def _platforms(mdf_snapshot: dict, apply_margins: bool) -> list[_Platform]:
    out = []
    for link in mdf_snapshot.get("links", []):
        snap = link.get("platform_snapshot") or {}
        p = _Platform(
            id=str(link["platform_id"]),
            name=link.get("platform_name") or snap.get("name") or "?",
            version_label=link.get("platform_version_label") or (
                f"v{link['platform_version_number']}" if link.get("platform_version_number") else None
            ),
        )
        for e_link in snap.get("links", []):
            eid = str(e_link["emitter_id"])
            emitter = e_link.get("emitter_snapshot") or {}
            p.emitters[eid] = {
                "emitter_id": eid,
                "emitter_name": e_link.get("emitter_name") or emitter.get("name") or "?",
                "designation": emitter.get("designation"),
                "version_number": e_link.get("emitter_version_number"),
            }
            for group in emitter.get("ew_groups", []):
                scan = _span(group.get("scan_min"), group.get("scan_max"))
                if scan is not None and apply_margins:
                    scan = apply_delta(scan[0], scan[1], group.get("scan_delta"))
                for mode in group.get("modes", []):
                    if mode.get("line") is None:
                        continue
                    flat = FlatModeLine(
                        mode_id=str(mode["id"]),
                        mode_name=mode["name"],
                        pri_type=mode["pri_type"],
                        ew_group_id=str(group.get("id")),
                        ew_group_name=group.get("name") or "",
                        source_id="",
                        source_name="",
                        emitter_id=eid,
                        emitter_name=p.emitters[eid]["emitter_name"],
                        platform_id=p.id,
                        platform_name=p.name,
                        line=mode["line"],
                    )
                    p.modes.append(_Mode(flat, compared_line(mode["line"], apply_margins), scan, group.get("name") or ""))
        out.append(p)
    return out


def _compare(a: _Mode, b: _Mode, apply_margins: bool, step_delta: float) -> dict:
    """How two Modes compare, parameter by parameter: whether each overlaps,
    and whether the two could be taken for each other (the ambiguity check's
    test: every compared dimension overlapping, same PRI type)."""
    rf = _overlaps(_span(a.line.get("rf_min_mhz"), a.line.get("rf_max_mhz")), _span(b.line.get("rf_min_mhz"), b.line.get("rf_max_mhz")))
    pw = _overlaps(_span(a.line.get("pw_min_us"), a.line.get("pw_max_us")), _span(b.line.get("pw_min_us"), b.line.get("pw_max_us")))
    scan = a.scan is not None and b.scan is not None and _overlaps(a.scan, b.scan)
    if a.flat.pri_type != b.flat.pri_type:
        # A different PRI type tells them apart.
        return {"rf": rf, "pw": pw, "pri": False, "scan": scan, "confusable": False}
    pri_result = _pri_and_jitter(a.flat, b.flat, a.line, b.line, apply_margins, step_delta)
    if pri_result is None:
        return {"rf": rf, "pw": pw, "pri": False, "scan": scan, "confusable": False}
    pri_pct, jitter_pct, _, _ = pri_result
    pri = pri_pct is None or pri_pct > 0  # CW / X-let: no PRI to tell them apart
    jitter = jitter_pct is None or jitter_pct > 0
    return {"rf": rf, "pw": pw, "pri": pri, "scan": scan, "confusable": rf and pw and pri and jitter}


def _mode_out(m: _Mode, others: list[_Mode], apply_margins: bool, step_delta: float) -> dict:
    hits = {"rf": False, "pri": False, "pw": False, "scan": False}
    confusable: list[_Mode] = []
    for o in others:
        c = _compare(m, o, apply_margins, step_delta)
        for p in ("rf", "pri", "pw", "scan"):
            hits[p] = hits[p] or c[p]
        if c["confusable"]:
            confusable.append(o)
    has_pri = m.flat.pri_type in ("fixed", "stagger")
    unique_params = [p for p in ("rf", "pri", "pw", "scan") if not hits[p] and (p != "pri" or has_pri) and (p != "scan" or m.scan)]
    return {
        "mode_id": m.flat.mode_id,
        "mode_name": m.flat.mode_name,
        "ew_group_name": m.ew_group_name,
        "pri_type": m.flat.pri_type,
        "unique_set": not confusable,
        "unique_params": unique_params,
        "overlap_count": len(confusable),
        "overlaps": [
            {
                "platform_id": o.flat.platform_id,
                "platform_name": o.flat.platform_name,
                "emitter_id": o.flat.emitter_id,
                "emitter_name": o.flat.emitter_name,
                "mode_id": o.flat.mode_id,
                "mode_name": o.flat.mode_name,
            }
            for o in confusable[:OVERLAPS_SHOWN]
        ],
    }


def mdf_uniqueness(mdf_snapshot: dict, tolerance: dict | None = None) -> list[dict]:
    """Each Platform pinned in the MDF version: its Emitters, unique or shared;
    a unique Emitter's Modes with their unique set and parameters; its unique
    pairs; and the Platforms that have everything it has."""
    tolerance = {**DEFAULT_TOLERANCE, **(tolerance or {})}
    apply_margins = bool(tolerance.get("apply_margins", True))
    step_delta = float(tolerance.get("stagger_step_delta_us") or 0.0)
    platforms = _platforms(mdf_snapshot, apply_margins)

    pinned_on: dict[str, list[_Platform]] = defaultdict(list)
    for p in platforms:
        for eid in p.emitters:
            pinned_on[eid].append(p)

    out = []
    for p in platforms:
        others = [m for q in platforms if q.id != p.id for m in q.modes]
        emitters = []
        for eid, info in sorted(p.emitters.items(), key=lambda kv: kv[1]["emitter_name"].lower()):
            shared_with = [{"platform_id": q.id, "platform_name": q.name} for q in pinned_on[eid] if q.id != p.id]
            modes = []
            if not shared_with:
                for m in sorted((m for m in p.modes if m.flat.emitter_id == eid), key=lambda m: (m.ew_group_name, m.flat.mode_name)):
                    modes.append(_mode_out(m, others, apply_margins, step_delta))
            emitters.append(
                {
                    **info,
                    "unique": not shared_with,
                    "shared_with": sorted(shared_with, key=lambda s: s["platform_name"].lower()),
                    "modes": modes,
                    "mode_count": sum(1 for m in p.modes if m.flat.emitter_id == eid),
                    "unique_set_count": sum(1 for m in modes if m["unique_set"]),
                }
            )

        shared = [e for e in emitters if not e["unique"]]
        pairs = []
        for a, b in combinations(shared, 2):
            both = {q.id for q in pinned_on[a["emitter_id"]]} & {q.id for q in pinned_on[b["emitter_id"]]}
            if both == {p.id}:
                pairs.append({"emitters": [_ref(a), _ref(b)]})
        mine = set(p.emitters)
        covered_by = [
            {"platform_id": q.id, "platform_name": q.name}
            for q in platforms
            if q.id != p.id and mine and mine <= set(q.emitters)
        ]
        out.append(
            {
                "platform_id": p.id,
                "platform_name": p.name,
                "version_label": p.version_label,
                "emitters": emitters,
                "unique_emitter_count": sum(1 for e in emitters if e["unique"]),
                "unique_set_count": sum(e["unique_set_count"] for e in emitters),
                "unique_pair_count": len(pairs),
                "unique_pairs": pairs[:PAIRS_SHOWN],
                "covered_by": sorted(covered_by, key=lambda c: c["platform_name"].lower()),
            }
        )
    return sorted(out, key=lambda p: p["platform_name"].lower())


def _ref(e: dict) -> dict:
    return {"emitter_id": e["emitter_id"], "emitter_name": e["emitter_name"], "designation": e["designation"]}

