import type { ObservedValues } from "../../api/testRecords";
import type { TestResult, TestType } from "../../types/domain";

export const TEST_RESULTS: TestResult[] = ["pass", "fail", "partial", "inconclusive"];

/** How a line outcome reads for a SIM Test Line. */
export function lineOutcomeLabel(o: TestResult): string {
  switch (o) {
    case "pass":
      return "correct";
    case "partial":
      return "misclassified";
    case "fail":
      return "missed";
    case "inconclusive":
      return "inconclusive";
  }
}

export function testTypeLabel(t: TestType): string {
  return t.replace("_", " ");
}

export function nonEmptySets(sets: ObservedValues[] | null | undefined): ObservedValues[] {
  return (sets ?? []).filter((set) => Object.keys(set).length > 0);
}

export function formatObservedValueSet(v: ObservedValues): string | null {
  const parts: string[] = [];
  if (v.rf_min_mhz != null || v.rf_max_mhz != null) parts.push(`RF ${v.rf_min_mhz ?? "?"}–${v.rf_max_mhz ?? "?"} MHz`);
  if (v.pw_min_us != null || v.pw_max_us != null) parts.push(`PW ${v.pw_min_us ?? "?"}–${v.pw_max_us ?? "?"} µs`);
  if (v.pri_type === "fixed" && (v.pri_min_us != null || v.pri_max_us != null)) {
    let pri = `PRI ${v.pri_min_us ?? "?"}–${v.pri_max_us ?? "?"} µs`;
    if (v.jitter_min_us != null || v.jitter_max_us != null) pri += ` (jitter ${v.jitter_min_us ?? "?"}–${v.jitter_max_us ?? "?"})`;
    parts.push(pri);
  } else if (v.pri_type === "stagger" && v.pri_stagger_values_us?.length) {
    parts.push(`PRI [${v.pri_stagger_values_us.join(", ")}] µs`);
  } else if (v.pri_type === "cw" || v.pri_type === "xlet") {
    parts.push(`PRI ${v.pri_type.toUpperCase()}`);
  }
  return parts.length ? parts.join(", ") : null;
}

/** One line per non-empty set, for table cells. */
export function formatObservedValueLines(sets: ObservedValues[] | null | undefined): string[] {
  return nonEmptySets(sets)
    .map(formatObservedValueSet)
    .filter((s): s is string => s != null);
}
