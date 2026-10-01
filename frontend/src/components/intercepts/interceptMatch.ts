import type { InterceptEntry, Mode } from "../../types/domain";

/** What matching needs from an entry — a saved one, or one still being
 * put together (the CSV import's preview). */
export type MatchableEntry = Pick<InterceptEntry, "pri_type" | "rf_mean_mhz" | "pri_mean_us" | "pw_mean_us" | "stagger_values">;

/** One of the three parameters an entry is matched on. */
export type MatchParam = "RF" | "PRI" | "PW";

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
  /** Modes it misses on exactly one parameter — only listed when nothing
   * matches fully, and never for CW (compared on RF alone, so "one off"
   * would be every CW Mode). */
  near: ModeMatch[];
}

function range(min: number | null | undefined, max: number | null | undefined) {
  return min == null || max == null ? null : { min, max };
}

function check(param: MatchParam, value: number | null, r: { min: number; max: number } | null, unit: string): ParamMiss | null {
  if (value == null || r == null || (value >= r.min && value <= r.max)) return null;
  return { param, value, min: r.min, max: r.max, unit, label: param };
}

/** How one entry compares with one Mode: which of RF, PRI and PW fall
 * outside the Mode's engineered range (the range the system recognises —
 * the plain min/max when a Mode has no deltas). Null when they can't be
 * compared at all: a different PRI type, or a Mode with no values yet.
 * Jitter isn't compared — it describes the pulse train, not whether the
 * system would put the signal in this Mode. A CW entry is compared on RF
 * only — it has no pulses. */
export function compareEntryToMode(entry: MatchableEntry, mode: Mode): ParamMiss[] | null {
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
    misses.push(pri && { ...pri, label: "Frame time" });
  } else {
    misses.push(
      check(
        "PRI",
        entry.pri_mean_us,
        range(line.engineered_pri_min_us ?? line.pri_min_us, line.engineered_pri_max_us ?? line.pri_max_us),
        "µs",
      ),
    );
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
export function matchEntry(entry: MatchableEntry, modes: Mode[]): EntryMatch {
  const matches: Mode[] = [];
  const near: ModeMatch[] = [];
  for (const mode of modes) {
    const misses = compareEntryToMode(entry, mode);
    if (misses == null) continue;
    if (misses.length === 0) matches.push(mode);
    else if (misses.length === 1 && entry.pri_type !== "cw") near.push({ mode, misses });
  }
  if (matches.length > 0) return { status: "match", matches, near: [] };
  return { status: near.length > 0 ? "near" : "none", matches, near };
}

/** e.g. "RF 9244 MHz — Mode covers 9060–9240". */
export function describeMiss(miss: ParamMiss): string {
  if (miss.positions) {
    return `${miss.positions.entry}-position stagger — Mode has ${miss.positions.mode}`;
  }
  return `${miss.label} ${miss.value} ${miss.unit} — Mode covers ${miss.min}–${miss.max}`;
}

export function countMatches(entries: MatchableEntry[], modes: Mode[]) {
  const counts = { match: 0, near: 0, none: 0 };
  for (const e of entries) counts[matchEntry(e, modes).status] += 1;
  return counts;
}
