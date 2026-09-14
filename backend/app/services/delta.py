def apply_delta(
    value_min: float | None, value_max: float | None, delta: float | None
) -> tuple[float | None, float | None]:
    """Widen a raw [value_min, value_max] range by a symmetric +/- delta tolerance
    margin to derive its engineered value. A null/zero delta is a no-op passthrough.
    """
    if value_min is None or value_max is None or not delta:
        return value_min, value_max
    return value_min - delta, value_max + delta
