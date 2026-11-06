"""An Emitter's frequency range as it's programmed: each Mode's RF min/max
with its delta applied (what the PRS export writes), and the Emitter's as
the lowest and highest of its Modes'. Shown beside Emitters and Modes on the
test pages, so the range is at hand while testing."""

from app.services.delta import apply_delta


def mode_rf_range(mode: dict) -> tuple[float | None, float | None]:
    line = mode.get("line") or {}
    return apply_delta(line.get("rf_min_mhz"), line.get("rf_max_mhz"), line.get("rf_delta"))


def mode_rf_ranges(snapshot: dict | None) -> dict[str, list[float | None]]:
    """Each Mode's [min, max] in an Emitter snapshot, by Mode id."""
    return {
        str(mode.get("id")): list(mode_rf_range(mode))
        for group in (snapshot or {}).get("ew_groups", [])
        for mode in group.get("modes", [])
        if mode.get("id")
    }


def emitter_rf_range(snapshot: dict | None) -> tuple[float | None, float | None]:
    """The lowest Mode minimum and highest Mode maximum (None without Modes)."""
    lows, highs = [], []
    for group in (snapshot or {}).get("ew_groups", []):
        for mode in group.get("modes", []):
            low, high = mode_rf_range(mode)
            if low is not None:
                lows.append(low)
            if high is not None:
                highs.append(high)
    return (min(lows) if lows else None, max(highs) if highs else None)
