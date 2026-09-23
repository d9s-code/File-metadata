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

function range(min: number | undefined, max: number | undefined): string | null {
  return min != null || max != null ? `${min ?? "?"}–${max ?? "?"}` : null;
}

export function formatObservedValueSet(v: ObservedValues): string | null {
  const parts: string[] = [];
  const rf = v.rf_mean_mhz ?? range(v.rf_min_mhz, v.rf_max_mhz);
  if (rf != null) parts.push(`RF ${rf} MHz`);
  if (v.pri_type === "fixed") {
    const pri = v.pri_mean_us ?? range(v.pri_min_us, v.pri_max_us);
    const jitter = v.jitter_mean_us ?? range(v.jitter_min_us, v.jitter_max_us);
    if (pri != null) parts.push(`PRI ${pri} µs${jitter != null ? ` (jitter ${jitter})` : ""}`);
    else if (jitter != null) parts.push(`jitter ${jitter} µs`);
  } else if (v.pri_type === "stagger" && (v.pri_stagger_values_us?.length || v.frame_time_us != null)) {
    let pri = v.pri_stagger_values_us?.length ? `PRI [${v.pri_stagger_values_us.join(", ")}] µs` : "PRI stagger";
    if (v.frame_time_us != null) pri += ` (frame time ${v.frame_time_us} µs)`;
    parts.push(pri);
  } else if (v.pri_type === "cw" || v.pri_type === "xlet") {
    parts.push(`PRI ${v.pri_type.toUpperCase()}`);
  }
  const pw = v.pw_mean_us ?? range(v.pw_min_us, v.pw_max_us);
  if (pw != null) parts.push(`PW ${pw} µs`);
  return parts.length ? parts.join(", ") : null;
}

/** One line per non-empty set, for table cells. */
export function formatObservedValueLines(sets: ObservedValues[] | null | undefined): string[] {
  return nonEmptySets(sets)
    .map(formatObservedValueSet)
    .filter((s): s is string => s != null);
}

/** One pickable set of intercepted parameters, for pre-filling a new Mode. */
export interface ObservedValueOption {
  key: string;
  label: string;
  values: ObservedValues;
}

/** Every logged set under each owner (a SIM Test Line or a Mode), labelled
 * with its owner, its number when there are several, and what it holds, so
 * sets on the same line can be told apart. */
export function observedValueOptions(
  owners: { id: string; name: string; sets: ObservedValues[] | null | undefined }[],
): ObservedValueOption[] {
  return owners.flatMap((owner) => {
    const sets = nonEmptySets(owner.sets);
    return sets.map((values, i) => {
      const summary = formatObservedValueSet(values);
      const name = sets.length > 1 ? `${owner.name} — set ${i + 1}` : owner.name;
      return { key: `${owner.id}:${i}`, label: summary ? `${name}: ${summary}` : name, values };
    });
  });
}
