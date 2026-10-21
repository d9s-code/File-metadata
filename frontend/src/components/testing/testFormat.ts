import type { ObservedValues } from "../../api/testRecords";
import type { TestResult, TestType } from "../../types/domain";

export const TEST_RESULTS: TestResult[] = ["pass", "fail", "partial", "inconclusive"];

/** How a line outcome reads for a SIM Test Line. */
export function lineOutcomeLabel(o: TestResult): string {
  switch (o) {
    case "pass":
      return "Correct";
    case "partial":
      return "Partial";
    case "fail":
      return "Missed";
    case "inconclusive":
      return "Inconclusive";
  }
}

const TEST_RESULT_LABELS: Record<TestResult, string> = {
  pass: "Pass",
  fail: "Fail",
  partial: "Partial",
  inconclusive: "Inconclusive",
};

/** How a run's or a Mode's result reads. */
export function testResultLabel(r: TestResult | string): string {
  return TEST_RESULT_LABELS[r as TestResult] ?? r;
}

const TEST_TYPE_LABELS: Record<TestType, string> = {
  simulation: "Simulation Test",
  intercept: "Intercept Test",
  lab_bench: "Lab Bench Test",
  live_range: "Live Range Test",
  field_exercise: "Field Exercise Test",
};

export function testTypeLabel(t: TestType): string {
  return TEST_TYPE_LABELS[t] ?? t;
}

export function nonEmptySets(sets: ObservedValues[] | null | undefined): ObservedValues[] {
  return (sets ?? []).filter((set) => Object.keys(set).length > 0);
}

/** A set with values but no Received Power — a run can't be logged with one. */
export function lacksPower(set: ObservedValues): boolean {
  return Object.keys(set).length > 0 && set.received_power_dbfs == null;
}

/** "Give the Received Power…" naming each owner (a SIM line, a Mode, a
 * signal) with a set that lacks it; null when none do. */
export function missingPowerMessage(owners: { name: string; sets: ObservedValues[] | null | undefined }[]): string | null {
  const names = owners.filter((o) => (o.sets ?? []).some(lacksPower)).map((o) => o.name);
  return names.length ? `Give the Received Power (dBFS) of every set of logged values — missing for ${names.join(", ")}.` : null;
}

function range(min: number | undefined, max: number | undefined): string | null {
  return min != null || max != null ? `${min ?? "?"}–${max ?? "?"}` : null;
}

/** A value kept in µs, as the ns it's typed and shown in on a test run
 * (jitter, stagger steps). Rounded so 0.0012 µs reads 1.2, not 1.2000000000000002. */
export function nsOf(us: number): number {
  return Number((us * 1000).toPrecision(12));
}
/** Typed in ns, kept in µs. */
export function usOfNs(ns: number): number {
  return Number((ns / 1000).toPrecision(12));
}

/** A stagger's logged steps in ns, in order — "1250, 1310, 1280". */
export function staggerNs(v: ObservedValues): string | null {
  return v.pri_stagger_values_us?.length ? v.pri_stagger_values_us.map(nsOf).join(", ") : null;
}

/** A jitter logged in µs, in ns — how it's typed and shown. */
export function jitterNs(v: ObservedValues): string | null {
  const ns = (us: number | undefined) => (us == null ? undefined : nsOf(us));
  if (v.jitter_mean_us != null) return String(ns(v.jitter_mean_us));
  return range(ns(v.jitter_min_us), ns(v.jitter_max_us));
}

export function formatObservedValueSet(v: ObservedValues): string | null {
  const parts: string[] = [];
  const rf = v.rf_mean_mhz ?? range(v.rf_min_mhz, v.rf_max_mhz);
  if (rf != null) parts.push(`RF ${rf} MHz`);
  if (v.pri_type === "fixed") {
    const pri = v.pri_mean_us ?? range(v.pri_min_us, v.pri_max_us);
    const jitter = jitterNs(v);
    if (pri != null) parts.push(`PRI ${pri} µs${jitter != null ? ` (jitter ${jitter} ns)` : ""}`);
    else if (jitter != null) parts.push(`jitter ${jitter} ns`);
  } else if (v.pri_type === "stagger" && (v.pri_stagger_values_us?.length || v.frame_time_us != null)) {
    let pri = v.pri_stagger_values_us?.length ? `PRI stagger [${staggerNs(v)}] ns` : "PRI stagger";
    if (v.frame_time_us != null) pri += ` (frame time ${v.frame_time_us} µs)`;
    parts.push(pri);
  } else if (v.pri_type === "cw" || v.pri_type === "xlet") {
    parts.push(`PRI ${v.pri_type.toUpperCase()}`);
  }
  const pw = v.pw_mean_us ?? range(v.pw_min_us, v.pw_max_us);
  if (pw != null) parts.push(`PW ${pw} µs`);
  if (v.received_power_dbfs != null) parts.push(`${v.received_power_dbfs} dBFS`);
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

/** SIM Test Lines in alphabetical order, numbers by value ("Line 2" before
 * "Line 10") — the order they're listed in everywhere: the panel, a new run
 * and a run's report. */
export function compareLineLabels(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
