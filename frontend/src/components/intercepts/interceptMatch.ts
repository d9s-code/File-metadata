import type { InterceptEntry, Mode } from "../../types/domain";

/** What matching needs from an entry — a saved one, or one still being
 * put together (the CSV import's preview). */
export type MatchableEntry = Pick<InterceptEntry, "pri_type" | "rf_mean_mhz" | "pri_mean_us" | "pw_mean_us" | "stagger_values"> & {
  /** Fixed only: the jitter measured, µs (compared only when asked to). */
  jitter_mean_us?: number | null;
};

/** One of the three parameters an entry is matched on (jitter, when
 * checked, is part of its PRI). */
export type MatchParam = "RF" | "PRI" | "PW";

/** Further checks, on top of RF, PRI (a stagger's frame time) and PW:
 * a fixed PRI's jitter against the Mode's jitter range, and a stagger's
 * steps against the Mode's, in order. The test run's re-check asks for both. */
export interface MatchChecks {
  jitter?: boolean;
  sequence?: boolean;
}

export interface ParamMiss {
  param: MatchParam;
  /** What the entry measured (the frame time, for a stagger entry's PRI). */
  value: number;
  min: number;
  max: number;
  unit: string;
  /** How to name it — "Frame time" for a stagger entry's PRI. */
  label: string;
  /** Set when the entry's stagger has a different number of positions than
   * the Mode's — the frame time alone can't say that. */
  positions?: { entry: number; mode: number };
  /** Set when the steps (same number of them) aren't the Mode's in the same
   * order, each within ± tol µs — starting anywhere, as a train repeats. */
  sequence?: { entry: number[]; mode: number[]; tol: number };
}

export interface ModeMatch {
  mode: Mode;
  /** Empty for a full match. */
  misses: ParamMiss[];
}

export type EntryMatchStatus = "match" | "near" | "none";

export interface EntryMatch {
  status: EntryMatchStatus;
  /** Modes the entry falls inside on RF, PRI and PW. */
  matches: Mode[];
  /** Modes it misses on exactly one parameter (a stagger's frame time and
   * steps are both its PRI) — only listed when nothing matches fully, and
   * never for CW (compared on RF alone, so "one off" would be every CW Mode). */
  near: ModeMatch[];
}

function range(min: number | null | undefined, max: number | null | undefined) {
  return min == null || max == null ? null : { min, max };
}

function check(param: MatchParam, value: number | null, r: { min: number; max: number } | null, unit: string): ParamMiss | null {
  if (value == null || r == null || (value >= r.min && value <= r.max)) return null;
  return { param, value, min: r.min, max: r.max, unit, label: param };
}

/** How far a measured step may be from the Mode's: its frame-time margin
 * (or PRI margin), and at least 0.1% of the step for measurement rounding. */
function stepTolerance(line: NonNullable<Mode["line"]>, step: number): number {
  return Math.max(line.frame_time_delta_us ?? 0, line.pri_delta ?? 0, step * 0.001);
}

/** The same steps in the same order, starting at any of them (a train repeats). */
export function sameSequence(steps: number[], modeSteps: number[], tol: (step: number) => number): boolean {
  const n = modeSteps.length;
  if (steps.length !== n) return false;
  for (let r = 0; r < n; r++) {
    if (steps.every((v, i) => Math.abs(v - modeSteps[(i + r) % n]) <= tol(modeSteps[(i + r) % n]))) return true;
  }
  return false;
}

/** How one entry compares with one Mode: which of RF, PRI and PW fall
 * outside the Mode's engineered range (the range the system recognises —
 * the plain min/max when a Mode has no deltas). Null when they can't be
 * compared at all: a different PRI type, or a Mode with no values yet.
 * Unless `checks` asks for them, jitter isn't compared, and a stagger is
 * compared on its frame time and number of steps only. A CW entry is
 * compared on RF only — it has no pulses. */
export function compareEntryToMode(entry: MatchableEntry, mode: Mode, checks: MatchChecks = {}): ParamMiss[] | null {
  const line = mode.line;
  if (!line || mode.pri_type !== entry.pri_type) return null;

  const misses: (ParamMiss | null)[] = [
    check(
      "RF",
      entry.rf_mean_mhz,
      range(line.engineered_rf_min_mhz ?? line.rf_min_mhz, line.engineered_rf_max_mhz ?? line.rf_max_mhz),
      "MHz",
    ),
  ];
  if (entry.pri_type === "cw") return misses.filter((m): m is ParamMiss => m != null);

  if (entry.pri_type === "stagger") {
    const frameTime =
      range(line.engineered_frame_time_min_us, line.engineered_frame_time_max_us) ??
      (line.frame_time_us != null ? { min: line.frame_time_us, max: line.frame_time_us } : null);
    let pri = check("PRI", entry.pri_mean_us, frameTime, "µs");
    const entryPositions = entry.stagger_values?.length ?? 0;
    const modePositions = line.pri_stagger_values_us?.length ?? 0;
    if (entryPositions > 0 && modePositions > 0 && entryPositions !== modePositions) {
      pri = {
        ...(pri ?? {
          param: "PRI",
          value: entry.pri_mean_us ?? 0,
          min: frameTime?.min ?? 0,
          max: frameTime?.max ?? 0,
          unit: "µs",
          label: "Frame time",
        }),
        positions: { entry: entryPositions, mode: modePositions },
      };
    }
    // The steps themselves, in order, when there's the same number of them.
    const steps = entry.stagger_values ?? [];
    const modeSteps = line.pri_stagger_values_us ?? [];
    if (checks.sequence && steps.length > 0 && steps.length === modeSteps.length) {
      const tol = (step: number) => stepTolerance(line, step);
      if (!sameSequence(steps, modeSteps, tol)) {
        pri = {
          ...(pri ?? {
            param: "PRI",
            value: entry.pri_mean_us ?? 0,
            min: frameTime?.min ?? 0,
            max: frameTime?.max ?? 0,
            unit: "µs",
            label: "Steps",
          }),
          sequence: { entry: steps, mode: modeSteps, tol: tol(Math.min(...modeSteps)) },
        };
      }
    }
    misses.push(pri && { ...pri, label: pri.label === "Steps" ? "Steps" : "Frame time" });
  } else {
    misses.push(
      check(
        "PRI",
        entry.pri_mean_us,
        range(line.engineered_pri_min_us ?? line.pri_min_us, line.engineered_pri_max_us ?? line.pri_max_us),
        "µs",
      ),
    );
    // The jitter measured against the Mode's jitter range.
    if (checks.jitter && entry.pri_type === "fixed" && entry.jitter_mean_us != null) {
      const j = range(line.jitter_min_us, line.jitter_max_us);
      if (j && (entry.jitter_mean_us < j.min - 1e-9 || entry.jitter_mean_us > j.max + 1e-9)) {
        misses.push({ param: "PRI", value: entry.jitter_mean_us, min: j.min, max: j.max, unit: "µs", label: "Jitter" });
      }
    }
  }

  misses.push(
    check(
      "PW",
      entry.pw_mean_us,
      range(line.engineered_pw_min_us ?? line.pw_min_us, line.engineered_pw_max_us ?? line.pw_max_us),
      "µs",
    ),
  );
  return misses.filter((m): m is ParamMiss => m != null);
}

/** Which of the Emitter's Modes an entry falls in — the question an
 * Intercept answers: is this a Mode we already have? */
export function matchEntry(entry: MatchableEntry, modes: Mode[], checks: MatchChecks = {}): EntryMatch {
  const matches: Mode[] = [];
  const near: ModeMatch[] = [];
  for (const mode of modes) {
    const misses = compareEntryToMode(entry, mode, checks);
    if (misses == null) continue;
    if (misses.length === 0) matches.push(mode);
    else if (new Set(misses.map((m) => m.param)).size === 1 && entry.pri_type !== "cw") near.push({ mode, misses });
  }
  if (matches.length > 0) return { status: "match", matches, near: [] };
  return { status: near.length > 0 ? "near" : "none", matches, near };
}

const steps = (v: number[]) => v.map((x) => Number(x.toPrecision(10))).join(", ");

/** e.g. "RF 9244 MHz — Mode covers 9060–9240". */
export function describeMiss(miss: ParamMiss): string {
  if (miss.positions) {
    return `${miss.positions.entry}-position stagger — Mode has ${miss.positions.mode}`;
  }
  const frame = `${miss.label === "Steps" ? "Frame time" : miss.label} ${miss.value} ${miss.unit} — Mode covers ${miss.min}–${miss.max}`;
  if (miss.sequence) {
    const { entry, mode, tol } = miss.sequence;
    // The same steps in another order, or steps the Mode doesn't have.
    const reordered = sameSequence([...entry].sort((a, b) => a - b), [...mode].sort((a, b) => a - b), () => tol);
    const order = `Steps ${steps(entry)} µs — Mode has ${steps(mode)} (± ${Number(tol.toPrecision(3))})${reordered ? ", not in this order" : ""}`;
    // The frame time too, if it's also outside.
    return miss.label === "Steps" ? order : `${order}; ${frame}`;
  }
  return frame;
}

export function countMatches(entries: MatchableEntry[], modes: Mode[]) {
  const counts = { match: 0, near: 0, none: 0 };
  for (const e of entries) counts[matchEntry(e, modes).status] += 1;
  return counts;
}
