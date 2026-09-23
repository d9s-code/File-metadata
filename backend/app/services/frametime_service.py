FRAME_TIME_DECIMALS = 3


def compute_frametime_us(stagger_values_us: list[float]) -> float:
    """Frame time for a stagger PRI sequence: the sum of one full cycle
    through the sequence, cut to 3 decimals so binary-float noise
    (100.1 + 200.2 = 300.29999999999995) never reaches the user or the
    export. round() keeps the input's type, so Decimal column values stay
    Decimal for apply_delta.
    """
    return round(sum(stagger_values_us), FRAME_TIME_DECIMALS)


def effective_frametime_us(stagger_values_us: list[float] | None, explicit_frame_time_us: float | None) -> float | None:
    """The frame time a stagger line actually uses: the hand-written one when
    set, otherwise the sum of the sequence."""
    if explicit_frame_time_us is not None:
        return round(explicit_frame_time_us, FRAME_TIME_DECIMALS)
    return compute_frametime_us(stagger_values_us) if stagger_values_us else None
