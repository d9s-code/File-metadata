from app.core.enums import TestResult

# Worst-to-best: a single failed Mode makes the whole test a fail even if
# everything else passed; a single partial (a real, if lesser, problem) beats
# an inconclusive (no real signal either way) when nothing outright failed.
_SEVERITY_ORDER = [TestResult.fail, TestResult.partial, TestResult.inconclusive, TestResult.pass_]


def compute_overall_result(mode_results: list[TestResult]) -> TestResult:
    """The whole-test result, derived from what actually happened to each
    Mode exercised — the worst result present, so the top-level number can
    never claim a cleaner outcome than any individual Mode saw.
    """
    if not mode_results:
        raise ValueError("compute_overall_result requires at least one Mode result")
    present = set(mode_results)
    for candidate in _SEVERITY_ORDER:
        if candidate in present:
            return candidate
    raise AssertionError("unreachable — every TestResult value is covered by _SEVERITY_ORDER")
