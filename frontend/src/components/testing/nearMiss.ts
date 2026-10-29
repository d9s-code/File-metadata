import type { ParamMiss } from "../intercepts/interceptMatch";
import type { LineValues } from "../modes/modeLine";
import type { Mode } from "../../types/domain";

const MISS_FIELDS: Record<string, [keyof LineValues, keyof LineValues, "rf_min_mhz" | "pri_min_us" | "pw_min_us" | "jitter_min_us", "rf_max_mhz" | "pri_max_us" | "pw_max_us" | "jitter_max_us"]> = {
  RF: ["rfMin", "rfMax", "rf_min_mhz", "rf_max_mhz"],
  PRI: ["priMin", "priMax", "pri_min_us", "pri_max_us"],
  PW: ["pwMin", "pwMax", "pw_min_us", "pw_max_us"],
  Jitter: ["jitterMin", "jitterMax", "jitter_min_us", "jitter_max_us"],
};

/** A near-miss Mode's line widened to take in the value it missed on (its
 * typed range, so the delta still goes on top). Stagger steps and frame
 * time aren't widened — the form opens on the Mode as it is. */
export function widened(mode: Mode, misses: ParamMiss[]): Partial<LineValues> {
  const change: Partial<LineValues> = {};
  const line = mode.line;
  if (!line) return change;
  for (const miss of misses) {
    const fields = MISS_FIELDS[miss.label];
    if (!fields || miss.positions || miss.sequence) continue;
    const [minKey, maxKey, minField, maxField] = fields;
    const lo = line[minField];
    const hi = line[maxField] ?? lo;
    if (lo == null || hi == null) continue;
    Object.assign(change, { [minKey]: String(Math.min(Number(lo), miss.value)), [maxKey]: String(Math.max(Number(hi), miss.value)) });
  }
  return change;
}
