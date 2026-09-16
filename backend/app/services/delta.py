def apply_delta(
    value_min: float | None, value_max: float | None, delta: float | None
) -> tuple[float | None, float | None]:
    """Widen a raw [value_min, value_max] range by a symmetric +/- delta tolerance
    margin to derive its engineered value. A null/zero delta is a no-op passthrough.

    Rounded to 4 decimal places — matching the Numeric(14, 4) precision every
    affected column already uses — so plain binary-float arithmetic (e.g.
    0.4 + 0.2) can't surface as noise like 0.6000000000000001 in the engineered
    value shown to the user.
    """
    if value_min is None or value_max is None or not delta:
        return value_min, value_max
    return round(value_min - delta, 4), round(value_max + delta, 4)
