"""Matching Intercept entries against an Emitter's Modes on the server — the
same rule as the frontend's interceptMatch.ts, so the Emitter page can show
the counts without downloading every entry. Keep the two in step.

An entry matches a Mode when its mean RF, PRI (frame time for a stagger) and
PW all fall within the Mode's engineered range (the plain min/max when a
Mode has no deltas). Only Modes of the same PRI type are compared. A near
miss is exactly one value off — RF, PRI (frame time), PW, or a stagger's
number of steps, each on its own — counted only when nothing matches fully,
and never for CW — compared on RF alone, "one off" would be every CW Mode —
and only when the value is close: within the admin's near-miss limit (5% by
default) of the bound it misses (a step count that differs always counts).
Jitter isn't compared.
"""

from dataclasses import dataclass
from typing import Literal

from app.core.enums import PriType
from app.models.intercept import InterceptEntry
from app.models.mode import Mode
from app.schemas.mode import ModeLineOut

Status = Literal["match", "near", "none"]
Range = tuple[float, float] | None


@dataclass(frozen=True)
class ModeRanges:
    """What matching needs from one Mode, worked out once per request."""

    pri_type: PriType
    rf: Range
    pri: Range  # frame time for a stagger Mode
    pw: Range
    positions: int  # a stagger Mode's number of positions


def _range(lo: float | None, hi: float | None) -> Range:
    return None if lo is None or hi is None else (float(lo), float(hi))


def _first(a: float | None, b: float | None) -> float | None:
    return a if a is not None else b


def mode_ranges(modes: list[Mode]) -> list[ModeRanges]:
    out = []
    for mode in modes:
        if mode.line is None:
            continue
        line = ModeLineOut.model_validate(mode.line)
        if mode.pri_type == PriType.stagger:
            pri = _range(line.engineered_frame_time_min_us, line.engineered_frame_time_max_us)
            if pri is None and line.frame_time_us is not None:
                pri = (float(line.frame_time_us), float(line.frame_time_us))
        else:
            pri = _range(
                _first(line.engineered_pri_min_us, line.pri_min_us), _first(line.engineered_pri_max_us, line.pri_max_us)
            )
        out.append(
            ModeRanges(
                pri_type=mode.pri_type,
                rf=_range(
                    _first(line.engineered_rf_min_mhz, line.rf_min_mhz),
                    _first(line.engineered_rf_max_mhz, line.rf_max_mhz),
                ),
                pri=pri,
                pw=_range(
                    _first(line.engineered_pw_min_us, line.pw_min_us), _first(line.engineered_pw_max_us, line.pw_max_us)
                ),
                positions=len(line.pri_stagger_values_us or []),
            )
        )
    return out


def _outside(value: float | None, r: Range) -> bool:
    return value is not None and r is not None and not (r[0] <= value <= r[1])


def near_distance_pct(value: float, r: tuple[float, float]) -> float:
    """How far a value is outside a range, as a % of the bound it misses (of
    the range's width, when that's larger) — as interceptMatch.ts's nearDistancePct."""
    lo, hi = r
    bound, d = (hi, value - hi) if value > hi else (lo, lo - value)
    return abs(d) / max(abs(bound), hi - lo, 1e-9) * 100


def _misses(entry: InterceptEntry, mode: ModeRanges) -> list[float] | None:
    """The values that are off — RF, PRI and PW outside the Mode, and a
    stagger's number of steps (its own value, apart from the frame time) —
    each as how far off it is (near_distance_pct; 0 for the steps), or None
    when the two can't be compared (a different PRI type)."""
    if mode.pri_type != entry.pri_type:
        return None
    off: list[float] = []

    def check(value: float | None, r: Range) -> None:
        if value is not None and r is not None and _outside(value, r):
            off.append(near_distance_pct(value, r))

    check(float(entry.rf_mean_mhz), mode.rf)
    if entry.pri_type == PriType.cw:
        return off
    check(None if entry.pri_mean_us is None else float(entry.pri_mean_us), mode.pri)
    if entry.pri_type == PriType.stagger:
        positions = len(entry.stagger_values or [])
        if positions > 0 and mode.positions > 0 and positions != mode.positions:
            off.append(0.0)
    check(None if entry.pw_mean_us is None else float(entry.pw_mean_us), mode.pw)
    return off


def entry_status(entry: InterceptEntry, modes: list[ModeRanges], near_pct: float = 5.0) -> Status:
    near = False
    for mode in modes:
        misses = _misses(entry, mode)
        if misses is None:
            continue
        if not misses:
            return "match"
        if len(misses) == 1 and entry.pri_type != PriType.cw and misses[0] <= near_pct + 1e-9:
            near = True
    return "near" if near else "none"
