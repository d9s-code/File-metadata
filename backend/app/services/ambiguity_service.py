"""Pairwise ambiguity analysis over a set of Mode lines extracted from a
committed version snapshot (never the live draft — see AmbiguityRun).

Each mode_line is treated as an RF x PW x PRI box. RF/PW always compare as
ranges. PRI comparison depends on the pair of PRI types: Fixed-vs-Fixed is
range overlap, Stagger compares discrete values against the other side's
range/set, and CW/Xlet carry no PRI value so the comparison degrades to
RF+PW-only (pri_overlap_pct is None, flagged via pri_comparison_type).
"""

from dataclasses import dataclass, field
from itertools import combinations
from typing import Any

DEFAULT_TOLERANCE = {"low_threshold": 30.0, "high_threshold": 70.0, "exact_threshold": 99.0}


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
    for ew_group in emitter_snapshot["ew_groups"]:
        for mode in ew_group["modes"]:
            if mode["line"] is None:
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


def compute_pairwise_findings(mode_lines: list[FlatModeLine], tolerance: dict | None = None) -> list[dict[str, Any]]:
    tolerance = tolerance or DEFAULT_TOLERANCE
    findings: list[dict[str, Any]] = []

    for a, b in combinations(mode_lines, 2):
        rf_pct = _range_overlap_pct(a.line["rf_min_mhz"], a.line["rf_max_mhz"], b.line["rf_min_mhz"], b.line["rf_max_mhz"])
        pw_pct = _range_overlap_pct(a.line["pw_min_us"], a.line["pw_max_us"], b.line["pw_min_us"], b.line["pw_max_us"])
        pri_pct, comparison_type = compute_pri_overlap(a.line, a.pri_type, b.line, b.pri_type)
        severity = compute_severity(rf_pct, pw_pct, pri_pct, tolerance)

        if severity == "none":
            continue  # No overlap at all in some dimension — not a finding worth storing.

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
                    "mode_a": {
                        "mode_name": a.mode_name,
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
