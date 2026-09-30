import type { ParameterSequenceStep } from "../../types/domain";

export type StepParam = "rf" | "pri" | "pw";

const FIELDS: Record<StepParam, [keyof ParameterSequenceStep, keyof ParameterSequenceStep, keyof ParameterSequenceStep]> = {
  rf: ["rf_mhz", "rf_min_mhz", "rf_max_mhz"],
  pri: ["pri_us", "pri_min_us", "pri_max_us"],
  pw: ["pw_us", "pw_min_us", "pw_max_us"],
};

/** Whether a step sets this parameter, as a single value or a range. */
export function stepHas(step: ParameterSequenceStep, param: StepParam): boolean {
  const [point, lo] = FIELDS[param];
  return step[point] != null || step[lo] != null;
}

/** "9000–9100" for a range, "9050" for a single value, null when unset. */
export function stepValueText(step: ParameterSequenceStep, param: StepParam): string | null {
  const [point, lo, hi] = FIELDS[param];
  if (step[lo] != null && step[hi] != null) return `${step[lo]}–${step[hi]}`;
  return step[point] != null ? String(step[point]) : null;
}

/** "RF 9000–9300 · PRI 800–900" — each parameter's lowest and highest value
 * across all of a sequence's steps, for a one-line collapsed summary. */
export function sequenceRangeSummary(steps: ParameterSequenceStep[]): string {
  const parts: string[] = [];
  for (const [param, name] of [["rf", "RF"], ["pri", "PRI"], ["pw", "PW"]] as const) {
    const [point, lo, hi] = FIELDS[param];
    const values = steps.flatMap((s) =>
      [s[point], s[lo], s[hi]].filter((v): v is number => typeof v === "number"),
    );
    if (values.length === 0) continue;
    const min = Math.min(...values);
    const max = Math.max(...values);
    parts.push(min === max ? `${name} ${min}` : `${name} ${min}–${max}`);
  }
  return parts.join(" · ");
}
