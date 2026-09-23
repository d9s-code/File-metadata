from decimal import Decimal

from app.services.frametime_service import compute_frametime_us


def test_float_noise_is_cut_to_three_decimals():
    assert compute_frametime_us([100.1, 200.2]) == 300.3
    assert compute_frametime_us([0.1, 0.1, 0.1]) == 0.3


def test_values_past_three_decimals_are_rounded():
    assert compute_frametime_us([1200.0004, 2400.0004]) == 3600.001


def test_decimal_input_stays_decimal():
    result = compute_frametime_us([Decimal("1200.1000"), Decimal("2400.0000")])
    assert isinstance(result, Decimal)
    assert result == Decimal("3600.100")
