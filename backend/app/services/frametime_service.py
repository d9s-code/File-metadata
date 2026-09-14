def compute_frametime_us(stagger_values_us: list[float]) -> float:
    """Frame time for a stagger PRI sequence: the sum of one full cycle
    through the sequence.
    """
    return sum(stagger_values_us)
