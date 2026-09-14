import type { TestResult } from "../../types/domain";

// Mirrors backend app/services/test_result_service.py exactly — worst-to-best,
// so a single failed Mode makes the whole test a fail even if everything
// else passed, and partial (a real if lesser problem) beats inconclusive (no
// real signal either way) when nothing outright failed.
const SEVERITY_ORDER: TestResult[] = ["fail", "partial", "inconclusive", "pass"];

export function computeOverallResult(modeResults: TestResult[]): TestResult | null {
  if (modeResults.length === 0) return null;
  const present = new Set(modeResults);
  for (const candidate of SEVERITY_ORDER) {
    if (present.has(candidate)) return candidate;
  }
  return null;
}
