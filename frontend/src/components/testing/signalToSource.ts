import type { ModeElementInput } from "../../api/elements";
import type { ObservedValues } from "../../api/testRecords";
import { nonEmptySets } from "./testFormat";

/** A measured value as a range: its min–max when logged, else its mean at both ends. */
function span(mean: number | undefined, min: number | undefined, max: number | undefined): [number, number] | null {
  if (min != null && max != null) return [min, max];
  const v = mean ?? min ?? max;
  return v == null ? null : [v, v];
}

/** Each parameter of a signal as its own Element, variant Intercept: RF, PRI
 * (a range with any jitter, or a stagger) and PW, for every logged set. */
export function signalElements(sets: ObservedValues[], label: string, details?: string): ModeElementInput[] {
  const out: ModeElementInput[] = [];
  const common = { variant: "intercept" as const, label, details: details || null };
  for (const set of nonEmptySets(sets)) {
    const rf = span(set.rf_mean_mhz, set.rf_min_mhz, set.rf_max_mhz);
    if (rf) out.push({ ...common, element_type: "rf", value_min: rf[0], value_max: rf[1] });
    if (set.pri_type === "stagger" && set.pri_stagger_values_us?.length) {
      // A stagger PRI element needs a frame-time margin; nothing was logged, so none.
      out.push({ ...common, element_type: "pri", stagger_values: set.pri_stagger_values_us, delta: 0 });
    } else if (set.pri_type === "fixed") {
      const pri = span(set.pri_mean_us, set.pri_min_us, set.pri_max_us);
      const jitter = span(set.jitter_mean_us, set.jitter_min_us, set.jitter_max_us);
      if (pri)
        out.push({
          ...common,
          element_type: "pri",
          value_min: pri[0],
          value_max: pri[1],
          jitter_min: jitter?.[0] ?? null,
          jitter_max: jitter?.[1] ?? null,
        });
    }
    const pw = span(set.pw_mean_us, set.pw_min_us, set.pw_max_us);
    if (pw) out.push({ ...common, element_type: "pw", value_min: pw[0], value_max: pw[1] });
  }
  return out;
}

interface SequenceStep {
  order: number;
  rf_mhz?: number;
  rf_min_mhz?: number;
  rf_max_mhz?: number;
  pri_us?: number;
  pri_min_us?: number;
  pri_max_us?: number;
  pw_us?: number;
  pw_min_us?: number;
  pw_max_us?: number;
}

function put(step: SequenceStep, point: "rf_mhz" | "pri_us" | "pw_us", range: [number, number] | null) {
  if (!range) return;
  if (range[0] === range[1]) {
    step[point] = range[0];
    return;
  }
  const [lo, hi] = ({ rf_mhz: ["rf_min_mhz", "rf_max_mhz"], pri_us: ["pri_min_us", "pri_max_us"], pw_us: ["pw_min_us", "pw_max_us"] } as const)[point];
  step[lo] = range[0];
  step[hi] = range[1];
}

/** The whole signal as one Parameter Sequence, variant Intercept: a step per
 * logged set with its RF, PRI and PW together — a stagger takes a step per
 * position. Null when nothing could go in a step. */
export function signalSequence(sets: ObservedValues[], label: string) {
  const steps: SequenceStep[] = [];
  for (const set of nonEmptySets(sets)) {
    const rf = span(set.rf_mean_mhz, set.rf_min_mhz, set.rf_max_mhz);
    const pw = span(set.pw_mean_us, set.pw_min_us, set.pw_max_us);
    const pris: ([number, number] | null)[] =
      set.pri_type === "stagger" && set.pri_stagger_values_us?.length
        ? set.pri_stagger_values_us.map((v) => [v, v])
        : [set.pri_type === "fixed" ? span(set.pri_mean_us, set.pri_min_us, set.pri_max_us) : null];
    for (const pri of pris) {
      const step: SequenceStep = { order: steps.length + 1 };
      put(step, "rf_mhz", rf);
      put(step, "pri_us", pri);
      put(step, "pw_us", pw);
      if (Object.keys(step).length > 1) steps.push(step);
    }
  }
  return steps.length ? { label, variant: "intercept" as const, steps } : null;
}
