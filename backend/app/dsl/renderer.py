from app.core.enums import PriType
from app.dsl.exceptions import DslSyntaxError


def _fmt(value: float) -> str:
    # Render whole numbers without a trailing ".0" but keep real decimals.
    if float(value).is_integer():
        return str(int(value))
    return f"{value:g}"


def render_mode_line(
    *,
    pri_type: PriType,
    rf_min_mhz: float,
    rf_max_mhz: float,
    pw_min_us: float,
    pw_max_us: float,
    pri_min_us: float | None = None,
    pri_max_us: float | None = None,
    jitter_min_us: float | None = None,
    jitter_max_us: float | None = None,
    pri_stagger_values_us: list[float] | None = None,
) -> str:
    """The inverse of parser.parse_mode_line — renders canonical DSL text so
    elements/cartesian-product output can always be shown as a mode line,
    proven consistent with parsing via round-trip tests.
    """
    rf = f"RF {_fmt(rf_min_mhz)}-{_fmt(rf_max_mhz)}"
    pw = f"PW {_fmt(pw_min_us)}-{_fmt(pw_max_us)}"

    if pri_type == PriType.fixed:
        if pri_min_us is None or pri_max_us is None or jitter_min_us is None or jitter_max_us is None:
            raise DslSyntaxError("Fixed PRI requires pri_min/max and jitter_min/max to render")
        pri = f"PRI FIXED {_fmt(pri_min_us)}-{_fmt(pri_max_us)} JITTER {_fmt(jitter_min_us)}-{_fmt(jitter_max_us)}"
    elif pri_type == PriType.stagger:
        if not pri_stagger_values_us:
            raise DslSyntaxError("Stagger PRI requires a non-empty sequence to render")
        values = ", ".join(_fmt(v) for v in pri_stagger_values_us)
        pri = f"PRI STAGGER [{values}]"
    elif pri_type == PriType.cw:
        pri = "PRI CW"
    else:
        raise DslSyntaxError(f"PRI Type '{pri_type}' has no DSL line syntax yet")

    return f"{rf} {pri} {pw}"
