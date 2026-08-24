from app.services.delta import apply_delta


def test_apply_delta_none_is_passthrough():
    assert apply_delta(2900, 3100, None) == (2900, 3100)


def test_apply_delta_zero_is_passthrough():
    assert apply_delta(2900, 3100, 0) == (2900, 3100)


def test_apply_delta_widens_symmetrically():
    assert apply_delta(2900, 3100, 5) == (2895, 3105)


def test_apply_delta_missing_range_is_passthrough():
    assert apply_delta(None, None, 5) == (None, None)
