"""Pairwise ambiguity analysis over a set of Mode lines extracted from a
committed version snapshot (never the live draft — see AmbiguityRun).

Each mode_line is treated as an RF x PW x PRI box — by default the box the
sensor matches with: each range widened by its ± margin (rf_delta, pw_delta,
pri_delta). A run's tolerance_config records that as apply_margins; runs
made before it existed compared the ranges as typed. RF/PW always compare as
ranges. PRI comparison depends on the pair of PRI types: Fixed-vs-Fixed is
range overlap, Stagger compares discrete values against the other side's
range/set, and CW/Xlet carry no PRI value so the comparison degrades to
RF+PW-only (pri_overlap_pct is None, flagged via pri_comparison_type).
"""

from dataclasses import dataclass, field
from itertools import combinations
from typing import Any

from app.services.delta import apply_delta
from app.services.snapshots import rejected_source_ids

DEFAULT_TOLERANCE = {"low_threshold": 30.0, "high_threshold": 70.0, "exact_threshold": 99.0, "apply_margins": True}

# Which parameter each overlap percentage belongs to, for "decided by".
_PARAMS = ("rf", "pw", "pri")


@dataclass
class FlatModeLine:
    mode_id: str
    mode_name: str
    pri_type: str
    ew_group_id: str
    ew_group_name: str
    source_id: str
    source_name: str
    emitter_id: str
    emitter_name: str
    platform_id: str | None
    platform_name: str | None
    line: dict = field(default_factory=dict)


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
            if mode["line"] is None or mode["source_id"] in rejected:
                continue
            out.append(
                FlatModeLine(
                    mode_id=mode["id"],
                    mode_name=mode["name"],
                    pri_type=mode["pri_type"],
                    ew_group_id=ew_group["id"],
                    ew_group_name=ew_group["name"],
                    source_id=mode["source_id"],
                    source_name=mode["source_name"],
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


def _stagger_vs_range_overlap_pct(stagger_values: list[float], range_min: float, range_max: float) -> float:
    if not stagger_values:
        return 0.0
    in_range = sum(1 for v in stagger_values if range_min <= v <= range_max)
    return round(100.0 * in_range / len(stagger_values), 2)


def compute_pri_overlap(line_a: dict, type_a: str, line_b: dict, type_b: str) -> tuple[float | None, str]:
    comparison_type = "-".join(sorted([type_a, type_b]))

    if type_a in ("cw", "xlet") or type_b in ("cw", "xlet"):
        return None, comparison_type

    if type_a == "fixed" and type_b == "fixed":
        pct = _range_overlap_pct(line_a["pri_min_us"], line_a["pri_max_us"], line_b["pri_min_us"], line_b["pri_max_us"])
    elif type_a == "stagger" and type_b == "stagger":
        pct = _stagger_values_overlap_pct(line_a["pri_stagger_values_us"] or [], line_b["pri_stagger_values_us"] or [])
    elif type_a == "fixed" and type_b == "stagger":
        pct = _stagger_vs_range_overlap_pct(line_b["pri_stagger_values_us"] or [], line_a["pri_min_us"], line_a["pri_max_us"])
    elif type_a == "stagger" and type_b == "fixed":
        pct = _stagger_vs_range_overlap_pct(line_a["pri_stagger_values_us"] or [], line_b["pri_min_us"], line_b["pri_max_us"])
    else:
        return None, comparison_type

    return pct, comparison_type


def compute_severity(rf_pct: float, pw_pct: float, pri_pct: float | None, tolerance: dict) -> str:
    dims = [rf_pct, pw_pct] + ([pri_pct] if pri_pct is not None else [])
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


def _compared(line: dict, pri_type: str) -> dict:
    """What a finding records about one side: the ranges actually compared."""
    return {
        "rf": [line["rf_min_mhz"], line["rf_max_mhz"]],
        "pw": [line["pw_min_us"], line["pw_max_us"]],
        "pri": [line["pri_min_us"], line["pri_max_us"]] if pri_type == "fixed" else None,
        "stagger": line.get("pri_stagger_values_us") if pri_type == "stagger" else None,
    }


def compute_pairwise_findings(mode_lines: list[FlatModeLine], tolerance: dict | None = None) -> list[dict[str, Any]]:
    tolerance = {**DEFAULT_TOLERANCE, **(tolerance or {})}
    apply_margins = bool(tolerance.get("apply_margins", True))
    findings: list[dict[str, Any]] = []
    lines = {id(m): compared_line(m.line, apply_margins) for m in mode_lines}

    for a, b in combinations(mode_lines, 2):
        la, lb = lines[id(a)], lines[id(b)]
        rf_pct = _range_overlap_pct(la["rf_min_mhz"], la["rf_max_mhz"], lb["rf_min_mhz"], lb["rf_max_mhz"])
        pw_pct = _range_overlap_pct(la["pw_min_us"], la["pw_max_us"], lb["pw_min_us"], lb["pw_max_us"])
        pri_pct, comparison_type = compute_pri_overlap(la, a.pri_type, lb, b.pri_type)
        severity = compute_severity(rf_pct, pw_pct, pri_pct, tolerance)

        if severity == "none":
            continue  # No overlap at all in some dimension — not a finding worth storing.
        # The parameter that overlaps least is the one that set the severity.
        pcts = {"rf": rf_pct, "pw": pw_pct, "pri": pri_pct}
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
                    "limiting": limiting,
                    "compared": {"mode_a": _compared(la, a.pri_type), "mode_b": _compared(lb, b.pri_type)},
                    "mode_a": {
                        "mode_name": a.mode_name,
                        "pri_type": a.pri_type,
                        "ew_group_id": a.ew_group_id,
                        "ew_group_name": a.ew_group_name,
                        "source_id": a.source_id,
                        "source_name": a.source_name,
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
        ):
            f["reviewed_by"] = prior["reviewed_by"]
            f["reviewed_at"] = prior["reviewed_at"]
            f["reviewer_note"] = prior["reviewer_note"]
