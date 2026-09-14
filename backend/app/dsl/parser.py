from dataclasses import dataclass, field
from pathlib import Path

from lark import Lark, Transformer
from lark.exceptions import LarkError, UnexpectedInput, VisitError

from app.core.enums import PriType
from app.dsl.exceptions import DslSyntaxError

_GRAMMAR_PATH = Path(__file__).parent / "grammar.lark"
_parser = Lark(_GRAMMAR_PATH.read_text(), parser="lalr")


@dataclass
class ParsedModeLine:
    rf_min_mhz: float
    rf_max_mhz: float
    pw_min_us: float
    pw_max_us: float
    pri_type: PriType
    pri_min_us: float | None = None
    pri_max_us: float | None = None
    jitter_min_us: float | None = None
    jitter_max_us: float | None = None
    pri_stagger_values_us: list[float] = field(default_factory=list)


class _ToModeLine(Transformer):
    def number(self, items):
        return float(items[0])

    def range(self, items):
        lo, hi = items
        if lo > hi:
            raise DslSyntaxError(f"Range lower bound {lo} must be <= upper bound {hi}")
        return (lo, hi)

    def fixed_clause(self, items):
        pri_range, jitter_range = items
        return {
            "pri_type": PriType.fixed,
            "pri_min_us": pri_range[0],
            "pri_max_us": pri_range[1],
            "jitter_min_us": jitter_range[0],
            "jitter_max_us": jitter_range[1],
        }

    def stagger_clause(self, items):
        values = [float(v) for v in items]
        if not values:
            raise DslSyntaxError("Stagger PRI requires at least one value")
        return {"pri_type": PriType.stagger, "pri_stagger_values_us": values}

    def cw_clause(self, items):
        return {"pri_type": PriType.cw}

    def start(self, items):
        rf_range, pri_data, pw_range = items
        return ParsedModeLine(
            rf_min_mhz=rf_range[0],
            rf_max_mhz=rf_range[1],
            pw_min_us=pw_range[0],
            pw_max_us=pw_range[1],
            **pri_data,
        )


_transformer = _ToModeLine()


def parse_mode_line(text: str) -> ParsedModeLine:
    try:
        tree = _parser.parse(text)
    except UnexpectedInput as exc:
        raise DslSyntaxError(
            "Could not parse mode line", line=getattr(exc, "line", None), column=getattr(exc, "column", None)
        ) from exc
    except LarkError as exc:
        raise DslSyntaxError(str(exc)) from exc

    try:
        return _transformer.transform(tree)
    except VisitError as exc:
        if isinstance(exc.orig_exc, DslSyntaxError):
            raise exc.orig_exc from exc
        raise DslSyntaxError(str(exc.orig_exc)) from exc
    except LarkError as exc:
        raise DslSyntaxError(str(exc)) from exc
