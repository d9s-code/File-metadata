import type { ObservedValues } from "../../api/testRecords";
import type { Mode } from "../../types/domain";
import { matchEntry, type MatchableEntry } from "../intercepts/interceptMatch";
import { nonEmptySets } from "./testFormat";

function mid(mean: number | undefined, min: number | undefined, max: number | undefined): number | null {
  if (mean != null) return mean;
  if (min != null && max != null) return (min + max) / 2;
  return min ?? max ?? null;
}

/** A logged set as an Intercept entry, so it's matched against the Modes
 * the same way. Null without an RF or a PRI type — there's nothing to compare on. */
function asEntry(set: ObservedValues): MatchableEntry | null {
  const rf = mid(set.rf_mean_mhz, set.rf_min_mhz, set.rf_max_mhz);
  if (!set.pri_type || rf == null) return null;
  const stagger = set.pri_stagger_values_us ?? null;
  const pri =
    set.pri_type === "stagger"
      ? (set.frame_time_us ?? (stagger?.length ? stagger.reduce((a, b) => a + b, 0) : null))
      : set.pri_type === "fixed"
        ? mid(set.pri_mean_us, set.pri_min_us, set.pri_max_us)
        : null;
  return {
    pri_type: set.pri_type,
    rf_mean_mhz: rf,
    pri_mean_us: pri,
    pw_mean_us: mid(set.pw_mean_us, set.pw_min_us, set.pw_max_us),
    stagger_values: stagger,
  };
}

export type SignalCoverage =
  | { status: "covered"; modes: Mode[] }
  | { status: "new" }
  /** No set has an RF and a PRI type, so it can't be compared. */
  | { status: "unknown" };

/** Whether the Emitter's Modes already cover a logged signal — a signal no
 * Mode covers is new to the library. */
export function signalCoverage(sets: ObservedValues[] | null | undefined, modes: Mode[]): SignalCoverage {
  const entries = nonEmptySets(sets)
    .map(asEntry)
    .filter((e): e is MatchableEntry => e != null);
  if (entries.length === 0) return { status: "unknown" };
  const covering = new Map<string, Mode>();
  for (const entry of entries) for (const m of matchEntry(entry, modes).matches) covering.set(m.id, m);
  return covering.size > 0 ? { status: "covered", modes: [...covering.values()] } : { status: "new" };
}
