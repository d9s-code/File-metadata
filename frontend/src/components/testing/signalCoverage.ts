import type { ObservedValues } from "../../api/testRecords";
import type { Mode } from "../../types/domain";
import { matchEntry, type MatchableEntry, type ModeMatch } from "../intercepts/interceptMatch";
import { nonEmptySets } from "./testFormat";

function mid(mean: number | undefined, min: number | undefined, max: number | undefined): number | null {
  if (mean != null) return mean;
  if (min != null && max != null) return (min + max) / 2;
  return min ?? max ?? null;
}

/** A logged set as an Intercept entry, so it's matched against the Modes
 * the same way. Its PRI type, when not logged, from what was: stagger steps
 * make a stagger, a PRI a fixed one. Null without an RF or anything to say
 * the PRI type — there's nothing to compare on. */
export function asEntry(set: ObservedValues): MatchableEntry | null {
  const rf = mid(set.rf_mean_mhz, set.rf_min_mhz, set.rf_max_mhz);
  const stagger = set.pri_stagger_values_us ?? null;
  const priType =
    set.pri_type ??
    (stagger?.length || set.frame_time_us != null
      ? "stagger"
      : set.pri_mean_us != null || set.pri_min_us != null || set.pri_max_us != null
        ? "fixed"
        : undefined);
  if (!priType || rf == null) return null;
  const pri =
    priType === "stagger"
      ? (set.frame_time_us ?? (stagger?.length ? stagger.reduce((a, b) => a + b, 0) : null))
      : priType === "fixed"
        ? mid(set.pri_mean_us, set.pri_min_us, set.pri_max_us)
        : null;
  return {
    pri_type: priType,
    rf_mean_mhz: rf,
    pri_mean_us: pri,
    pw_mean_us: mid(set.pw_mean_us, set.pw_min_us, set.pw_max_us),
    stagger_values: stagger,
    jitter_mean_us: priType === "fixed" ? mid(set.jitter_mean_us, set.jitter_min_us, set.jitter_max_us) : null,
  };
}

export type SignalCoverage =
  | { status: "covered"; modes: Mode[] }
  | { status: "new" }
  /** No Mode covers it, but some miss it on just one value. */
  | { status: "near"; near: ModeMatch[] }
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
  const near = new Map<string, ModeMatch>();
  for (const entry of entries) {
    const match = matchEntry(entry, modes);
    for (const m of match.matches) covering.set(m.id, m);
    for (const n of match.near) if (!near.has(n.mode.id)) near.set(n.mode.id, n);
  }
  if (covering.size > 0) return { status: "covered", modes: [...covering.values()] };
  return near.size > 0 ? { status: "near", near: [...near.values()] } : { status: "new" };
}
