"""Pairwise ambiguity analysis over a set of Mode lines extracted from a
committed version snapshot (never the live draft — see AmbiguityRun).

Each mode_line is treated as an RF x PW x PRI box — by default the box the
sensor matches with: each range widened by its ± margin (rf_delta, pw_delta,
pri_delta). A run's tolerance_config records that as apply_margins; runs
made before it existed compared the ranges as typed. RF and PW always
compare as ranges.

Which pairs can be ambiguous at all (rules_version 2):
- Only Modes of the same PRI type — a different type tells them apart.
- Two Fixed: PRI and jitter both compare as ranges (a Fixed Mode always has
  jitter; 0–0 is a steady PRI, not "no jitter").
- Two Staggers: both with PRI range matching on are compared on their frame
  time (± frame margin); neither, on their identical steps; only one with
  range matching on tells them apart.
- Two CW or two X-let: RF and PW only (pri_overlap_pct is None).
"""

from dataclasses import dataclass, field
from itertools import combinations
from typing import Any

from app.services.delta import apply_delta
from app.services.frametime_service import effective_frametime_us
from app.services.mode_sources import all_rejected, mode_source_ids
from app.services.snapshots import rejected_source_ids

DEFAULT_TOLERANCE = {
    "low_threshold": 30.0,
    "high_threshold": 70.0,
    "exact_threshold": 99.0,
    "apply_margins": True,
    "rules_version": 2,
}

# Which parameter each overlap percentage belongs to, for "decided by".
_PARAMS = ("rf", "pw", "pri", "jitter")


@dataclass
class FlatModeLine:
    mode_id: str
    mode_name: str
    pri_type: str
    ew_group_id: str
    ew_group_name: str
    # The first Source (source_name lists them all).
    source_id: str
    source_name: str
    emitter_id: str
    emitter_name: str
    platform_id: str | None
    platform_name: str | None
    line: dict = field(default_factory=dict)
    # Every Source the Mode comes from, first one first.
    source_ids: list[str] = field(default_factory=list)
    source_names: list[str] = field(default_factory=list)


def flatten_emitter_snapshot(
    emitter_snapshot: dict,
    *,
    emitter_id: str | None = None,
    emitter_name: str | None = None,
    platform_id: str | None = None,
    platform_name: str | None = None,
) -> list[FlatModeLine]:
    out: list[FlatModeLine] = []
    eid = emitter_id or emitter_snapshot["id"]
    ename = emitter_name or emitter_snapshot["name"]
    rejected = rejected_source_ids(emitter_snapshot)
    for ew_group in emitter_snapshot["ew_groups"]:
        for mode in ew_group["modes"]:
            if mode["line"] is None or all_rejected(mode_source_ids(mode), rejected):
                continue
            out.append(
                FlatModeLine(
                    mode_id=mode["id"],
                    mode_name=mode["name"],
                    pri_type=mode["pri_type"],
                    ew_group_id=ew_group["id"],
                    ew_group_name=ew_group["name"],
                    source_id=mode["source_id"],
                    source_name=", ".join(mode.get("source_names") or [mode["source_name"]]),
                    source_ids=mode_source_ids(mode),
                    source_names=mode.get("source_names") or [mode["source_name"]],
                    emitter_id=eid,
                    emitter_name=ename,
                    platform_id=platform_id,
                    platform_name=platform_name,
                    line=mode["line"],
                )
            )
    return out


def flatten_platform_snapshot(
    platform_snapshot: dict, *, platform_id: str | None = None, platform_name: str | None = None
) -> list[FlatModeLine]:
    out: list[FlatModeLine] = []
    pid = platform_id or platform_snapshot["id"]
    pname = platform_name or platform_snapshot["name"]
    for link in platform_snapshot["links"]:
        out.extend(
            flatten_emitter_snapshot(
                link["emitter_snapshot"],
                emitter_id=link["emitter_id"],
                emitter_name=link["emitter_name"],
                platform_id=pid,
                platform_name=pname,
            )
        )
    return out


def flatten_mdf_snapshot(mdf_snapshot: dict) -> list[FlatModeLine]:
    out: list[FlatModeLine] = []
    for link in mdf_snapshot["links"]:
        out.extend(
            flatten_platform_snapshot(
                link["platform_snapshot"], platform_id=link["platform_id"], platform_name=link["platform_name"]
            )
        )
    return out


def _range_overlap_pct(a_min: float, a_max: float, b_min: float, b_max: float) -> float:
    intersection = max(0.0, min(a_max, b_max) - max(a_min, b_min))
    len_a, len_b = a_max - a_min, b_max - b_min
    min_len = min(len_a, len_b)
    if min_len <= 0:
        # A zero-length (point) range: overlap is binary — contained or not.
        point_min, point_max = (a_min, a_min) if len_a <= 0 else (b_min, b_min)
        other_min, other_max = (b_min, b_max) if len_a <= 0 else (a_min, a_max)
        return 100.0 if other_min <= point_min <= other_max else 0.0
    return round(100.0 * intersection / min_len, 2)


def _stagger_values_overlap_pct(values_a: list[float], values_b: list[float]) -> float:
    if not values_a or not values_b:
        return 0.0
    set_a = {round(v, 6) for v in values_a}
    set_b = {round(v, 6) for v in values_b}
    shared = set_a & set_b
    return round(100.0 * len(shared) / min(len(set_a), len(set_b)), 2)


def compute_severity(
    rf_pct: float, pw_pct: float, pri_pct: float | None, tolerance: dict, jitter_pct: float | None = None
) -> str:
    dims = [rf_pct, pw_pct] + [d for d in (pri_pct, jitter_pct) if d is not None]
    if any(d <= 0 for d in dims):
        return "none"
    exact = tolerance.get("exact_threshold", DEFAULT_TOLERANCE["exact_threshold"])
    if all(d >= exact for d in dims):
        return "exact_overlap"
    low = tolerance.get("low_threshold", DEFAULT_TOLERANCE["low_threshold"])
    high = tolerance.get("high_threshold", DEFAULT_TOLERANCE["high_threshold"])
    worst = min(dims)
    if worst < low:
        return "low"
    if worst < high:
        return "medium"
    return "high"


def compared_line(line: dict, apply_margins: bool) -> dict:
    """The line as the check compares it: with margins, each range widened by
    its ± delta, as the sensor matches. A stagger's step values stay as they
    are — two staggers overlap only on identical steps."""
    if not apply_margins:
        return line
    out = dict(line)
    for lo, hi, delta in (
        ("rf_min_mhz", "rf_max_mhz", "rf_delta"),
        ("pw_min_us", "pw_max_us", "pw_delta"),
        ("pri_min_us", "pri_max_us", "pri_delta"),
    ):
        out[lo], out[hi] = apply_delta(line.get(lo), line.get(hi), line.get(delta))
    return out


def _jitter_span(line: dict) -> tuple[float, float]:
    """A Fixed Mode's jitter range. Every Fixed Mode has one (the form requires
    it); a missing end, from data older than that, reads as the other end or 0."""
    lo, hi = line.get("jitter_min_us"), line.get("jitter_max_us")
    lo = hi if lo is None else lo
    hi = lo if hi is None else hi
    return float(lo or 0), float(hi or 0)


def frame_window(line: dict, apply_margins: bool) -> tuple[float, float] | None:
    """A Stagger's frame time, widened by its frame margin: what range matching
    compares."""
    frame = effective_frametime_us(line.get("pri_stagger_values_us"), line.get("explicit_frame_time_us"))
    if frame is None:
        return None
    return apply_delta(frame, frame, line.get("frame_time_delta_us") if apply_margins else None)


def _compared(line: dict, pri_type: str, frame: tuple[float, float] | None = None, jitter: bool = False) -> dict:
    """What a finding records about one side: the ranges actually compared."""
    return {
        "rf": [line["rf_min_mhz"], line["rf_max_mhz"]],
        "pw": [line["pw_min_us"], line["pw_max_us"]],
        "pri": [line["pri_min_us"], line["pri_max_us"]] if pri_type == "fixed" else None,
        "stagger": line.get("pri_stagger_values_us") if pri_type == "stagger" and frame is None else None,
        "frame_time": list(frame) if frame is not None else None,
        "jitter": list(_jitter_span(line)) if jitter else None,
    }


def _pri_and_jitter(a: FlatModeLine, b: FlatModeLine, la: dict, lb: dict, apply_margins: bool):
    """For a same-type pair: (pri %, jitter %, what PRI was compared on, frame
    windows) — or None when the rules say they can be told apart outright."""
    t = a.pri_type
    if t == "fixed":
        pri_pct = _range_overlap_pct(la["pri_min_us"], la["pri_max_us"], lb["pri_min_us"], lb["pri_max_us"])
        jitter_pct = _range_overlap_pct(*_jitter_span(a.line), *_jitter_span(b.line))
        return pri_pct, jitter_pct, "range", None
    if t == "stagger":
        ra, rb = bool(a.line.get("pri_range_matching")), bool(b.line.get("pri_range_matching"))
        if ra != rb:
            return None  # Only one is matched on its frame time.
        if ra:
            fa, fb = frame_window(a.line, apply_margins), frame_window(b.line, apply_margins)
            if fa is None or fb is None:
                return None
            return _range_overlap_pct(*fa, *fb), None, "frame_time", (fa, fb)
        steps = _stagger_values_overlap_pct(la.get("pri_stagger_values_us") or [], lb.get("pri_stagger_values_us") or [])
        return steps, None, "steps", None
    return None, None, None, None  # CW, X-let: no PRI.


def compute_pairwise_findings(
    mode_lines: list[FlatModeLine], tolerance: dict | None = None, *, across_emitters_only: bool = False
) -> list[dict[str, Any]]:
    """Every pair of Modes that could be taken for each other. With
    across_emitters_only (Platform and MDF checks), two Modes of the same
    Emitter are never compared — the question there is which Emitters can be
    told apart, not what overlaps inside one."""
    tolerance = {**DEFAULT_TOLERANCE, **(tolerance or {})}
    apply_margins = bool(tolerance.get("apply_margins", True))
    findings: list[dict[str, Any]] = []
    lines = {id(m): compared_line(m.line, apply_margins) for m in mode_lines}

    for a, b in combinations(mode_lines, 2):
        if across_emitters_only and a.emitter_id == b.emitter_id:
            continue
        if a.pri_type != b.pri_type:
            continue  # A different PRI type tells them apart.
        la, lb = lines[id(a)], lines[id(b)]
        pri = _pri_and_jitter(a, b, la, lb, apply_margins)
        if pri is None:
            continue
        pri_pct, jitter_pct, pri_basis, frames = pri
        rf_pct = _range_overlap_pct(la["rf_min_mhz"], la["rf_max_mhz"], lb["rf_min_mhz"], lb["rf_max_mhz"])
        pw_pct = _range_overlap_pct(la["pw_min_us"], la["pw_max_us"], lb["pw_min_us"], lb["pw_max_us"])
        comparison_type = f"{a.pri_type}-{b.pri_type}"
        severity = compute_severity(rf_pct, pw_pct, pri_pct, tolerance, jitter_pct)

        if severity == "none":
            continue  # No overlap at all in some dimension — not a finding worth storing.
        # The parameter that overlaps least is the one that set the severity.
        pcts = {"rf": rf_pct, "pw": pw_pct, "pri": pri_pct, "jitter": jitter_pct}
        limiting = min((p for p in _PARAMS if pcts[p] is not None), key=lambda p: pcts[p])

        findings.append(
            {
                "mode_id_a": a.mode_id,
                "mode_id_b": b.mode_id,
                "rf_overlap_pct": rf_pct,
                "pw_overlap_pct": pw_pct,
                "pri_overlap_pct": pri_pct,
                "pri_comparison_type": comparison_type,
                "combined_severity": severity,
                "details": {
                    "margins_applied": apply_margins,
                    "rules_version": tolerance.get("rules_version"),
                    "limiting": limiting,
                    "jitter_overlap_pct": jitter_pct,
                    "pri_basis": pri_basis,
                    "compared": {
                        "mode_a": _compared(la, a.pri_type, frames[0] if frames else None, jitter_pct is not None),
                        "mode_b": _compared(lb, b.pri_type, frames[1] if frames else None, jitter_pct is not None),
                    },
                    "mode_a": {
                        "mode_name": a.mode_name,
                        "pri_type": a.pri_type,
                        "ew_group_id": a.ew_group_id,
                        "ew_group_name": a.ew_group_name,
                        "source_id": a.source_id,
                        "source_name": a.source_name,
                        "source_ids": a.source_ids,
                        "source_names": a.source_names,
                        "emitter_id": a.emitter_id,
                        "emitter_name": a.emitter_name,
                        "platform_id": a.platform_id,
                        "platform_name": a.platform_name,
                        "line": a.line,
                    },
                    "mode_b": {
                        "mode_name": b.mode_name,
                        "pri_type": b.pri_type,
                        "ew_group_id": b.ew_group_id,
                        "ew_group_name": b.ew_group_name,
                        "source_id": b.source_id,
                        "source_name": b.source_name,
                        "source_ids": b.source_ids,
                        "source_names": b.source_names,
                        "emitter_id": b.emitter_id,
                        "emitter_name": b.emitter_name,
                        "platform_id": b.platform_id,
                        "platform_name": b.platform_name,
                        "line": b.line,
                    },
                },
            }
        )
    return findings


def carry_forward_reviews(new_findings: list[dict[str, Any]], prior_reviewed: list[dict[str, Any]]) -> None:
    """Mutates `new_findings` in place. `prior_reviewed` is the previous run's
    reviewed findings for the same scope, shaped like a subset of a finding
    dict (mode_id_a/b, the three overlap percentages, combined_severity,
    reviewed_by/reviewed_at/reviewer_note).

    A new finding inherits the prior review only when its mode-id pair
    (order-independent — a mode_a/mode_b re-run can flip) AND every overlap
    number AND severity are unchanged from the prior run. If any of those
    differ, the underlying Mode data changed and the finding legitimately
    needs a fresh look — carrying the old review forward would hide that.
    """
    by_pair = {frozenset((p["mode_id_a"], p["mode_id_b"])): p for p in prior_reviewed}
    for f in new_findings:
        prior = by_pair.get(frozenset((f["mode_id_a"], f["mode_id_b"])))
        if prior is None:
            continue
        if (
            prior["combined_severity"] == f["combined_severity"]
            and prior["rf_overlap_pct"] == f["rf_overlap_pct"]
            and prior["pw_overlap_pct"] == f["pw_overlap_pct"]
            and prior["pri_overlap_pct"] == f["pri_overlap_pct"]
            and prior.get("jitter_overlap_pct") == (f.get("details") or {}).get("jitter_overlap_pct")
        ):
            f["reviewed_by"] = prior["reviewed_by"]
            f["reviewed_at"] = prior["reviewed_at"]
            f["reviewer_note"] = prior["reviewer_note"]
