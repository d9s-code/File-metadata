import pytest

from app.core.enums import PriType
from app.dsl.exceptions import DslSyntaxError
from app.dsl.parser import parse_mode_line
from app.dsl.renderer import render_mode_line

FIXED_LINE = "RF 2900-3100 PRI FIXED 800-1200 JITTER 5-15 PW 0.5-1.2"
STAGGER_LINE = "RF 2900-3100 PRI STAGGER [800, 850, 900, 780] PW 0.5-1.2"
CW_LINE = "RF 2900-3100 PRI CW PW 0.5-1.2"


def _render(parsed):
    return render_mode_line(
        pri_type=parsed.pri_type,
        rf_min_mhz=parsed.rf_min_mhz,
        rf_max_mhz=parsed.rf_max_mhz,
        pw_min_us=parsed.pw_min_us,
        pw_max_us=parsed.pw_max_us,
        pri_min_us=parsed.pri_min_us,
        pri_max_us=parsed.pri_max_us,
        jitter_min_us=parsed.jitter_min_us,
        jitter_max_us=parsed.jitter_max_us,
        pri_stagger_values_us=parsed.pri_stagger_values_us or None,
    )


@pytest.mark.parametrize("line", [FIXED_LINE, STAGGER_LINE, CW_LINE])
def test_round_trip_parse_render_reparse(line):
    parsed = parse_mode_line(line)
    rendered = _render(parsed)
    reparsed = parse_mode_line(rendered)
    assert reparsed == parsed


def test_fixed_parses_expected_fields():
    parsed = parse_mode_line(FIXED_LINE)
    assert parsed.pri_type == PriType.fixed
    assert parsed.rf_min_mhz == 2900.0
    assert parsed.rf_max_mhz == 3100.0
    assert parsed.pri_min_us == 800.0
    assert parsed.pri_max_us == 1200.0
    assert parsed.jitter_min_us == 5.0
    assert parsed.jitter_max_us == 15.0


def test_stagger_preserves_order():
    parsed = parse_mode_line(STAGGER_LINE)
    assert parsed.pri_stagger_values_us == [800.0, 850.0, 900.0, 780.0]


def test_cw_has_no_pri_value():
    parsed = parse_mode_line(CW_LINE)
    assert parsed.pri_min_us is None
    assert parsed.pri_stagger_values_us == []


def test_case_insensitive_keywords():
    parsed = parse_mode_line("rf 2900-3100 pri cw pw 0.5-1.2")
    assert parsed.pri_type == PriType.cw


def test_single_value_stagger_list():
    parsed = parse_mode_line("RF 2900-3100 PRI STAGGER [800] PW 0.5-1.2")
    assert parsed.pri_stagger_values_us == [800.0]


@pytest.mark.parametrize(
    "bad_line",
    [
        "RF 3100-2900 PRI CW PW 0.5-1.2",  # rf min > max
        "RF 2900-3100 PRI CW PW 1.2-0.5",  # pw min > max
        "RF 2900-3100 PRI FIXED 800-1200 PW 0.5-1.2",  # fixed missing jitter
        "RF 2900-3100 PRI XLET PW 0.5-1.2",  # xlet has no line syntax yet
        "not a mode line at all",
        "",
    ],
)
def test_rejects_invalid_input(bad_line):
    with pytest.raises(DslSyntaxError):
        parse_mode_line(bad_line)


def test_error_reports_line_and_column_for_garbage_input():
    with pytest.raises(DslSyntaxError) as excinfo:
        parse_mode_line("garbage")
    assert excinfo.value.line is not None
    assert excinfo.value.column is not None


def test_render_rejects_fixed_missing_jitter():
    with pytest.raises(DslSyntaxError):
        render_mode_line(
            pri_type=PriType.fixed,
            rf_min_mhz=1,
            rf_max_mhz=2,
            pw_min_us=0.1,
            pw_max_us=0.2,
            pri_min_us=100,
            pri_max_us=200,
        )


def test_render_rejects_stagger_missing_sequence():
    with pytest.raises(DslSyntaxError):
        render_mode_line(pri_type=PriType.stagger, rf_min_mhz=1, rf_max_mhz=2, pw_min_us=0.1, pw_max_us=0.2)
