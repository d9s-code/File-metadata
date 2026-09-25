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
