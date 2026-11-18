"""A near miss on the server is what it is in the app: exactly one value off.
A stagger's number of steps is its own value, apart from its frame time."""

from types import SimpleNamespace

from app.core.enums import PriType
from app.services.intercept_match_service import ModeRanges, entry_status

STAGGER = ModeRanges(pri_type=PriType.stagger, rf=(9000, 9100), pri=(440, 460), pw=(0.5, 1.5), positions=3)
FIXED = ModeRanges(pri_type=PriType.fixed, rf=(9060, 9240), pri=(200, 220), pw=(0.5, 1.5), positions=0)


def _entry(pri_type, rf, pri, pw, steps=None):
    return SimpleNamespace(pri_type=pri_type, rf_mean_mhz=rf, pri_mean_us=pri, pw_mean_us=pw, stagger_values=steps)


def test_one_value_off_is_near():
    assert entry_status(_entry(PriType.fixed, 9244, 210, 1), [FIXED]) == "near"
    assert entry_status(_entry(PriType.stagger, 9050, 450, 1, [100, 150]), [STAGGER]) == "near"


def test_two_values_off_is_not():
    assert entry_status(_entry(PriType.fixed, 9300, 210, 3), [FIXED]) == "none"
    # Fewer steps and the frame time outside: two values, not one.
    assert entry_status(_entry(PriType.stagger, 9050, 250, 1, [100, 150]), [STAGGER]) == "none"


def test_a_match_is_a_match():
    assert entry_status(_entry(PriType.stagger, 9050, 450, 1, [100, 150, 200]), [STAGGER]) == "match"
