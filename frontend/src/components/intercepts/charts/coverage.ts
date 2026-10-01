import type { Mode } from "../../../types/domain";
import type { CsvReport, ReportPriType } from "../interceptCsv";

/** The parameters the import charts show. */
export type ChartParam = "rf" | "pri" | "frame" | "pw" | "jitter" | "stagger";

export type Interval = [number, number];

/** Merges overlapping intervals and sorts them, so a lookup is a binary search. */
function merge(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
    .sort((x, y) => x[0] - y[0]);
  const out: Interval[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export function inIntervals(intervals: Interval[], v: number): boolean {
  let lo = 0;
  let hi = intervals.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = intervals[mid];
    if (v < a) hi = mid - 1;
    else if (v > b) lo = mid + 1;
    else return true;
  }
  return false;
}

const pick = (
  engineered: number | null | undefined,
  raw: number | null | undefined,
) => engineered ?? raw ?? null;

/** Where the Emitter's Modes reach, per parameter and PRI type, using the
 * engineered ranges (the ones the system recognises) like the entry matching
 * does. A report is compared only with Modes of its own PRI type. Stagger
 * positions aren't compared — a Mode has no range per position. */
export function modeCoverage(
  modes: Mode[],
): Record<ChartParam, Partial<Record<ReportPriType, Interval[]>>> {
  const raw: Record<ChartParam, Partial<Record<ReportPriType, Interval[]>>> = {
    rf: {},
    pri: {},
    frame: {},
    pw: {},
    jitter: {},
    stagger: {},
  };
  const add = (
    param: ChartParam,
    type: ReportPriType,
    lo: number | null,
    hi: number | null,
  ) => {
    if (lo == null || hi == null) return;
    (raw[param][type] ??= []).push([lo, hi]);
  };
  for (const m of modes) {
    const line = m.line;
    if (
      !line ||
      (m.pri_type !== "fixed" &&
        m.pri_type !== "stagger" &&
        m.pri_type !== "cw")
    )
      continue;
    const t = m.pri_type;
    add(
      "rf",
      t,
      pick(line.engineered_rf_min_mhz, line.rf_min_mhz),
      pick(line.engineered_rf_max_mhz, line.rf_max_mhz),
    );
    if (t === "cw") continue;
    add(
      "pw",
      t,
      pick(line.engineered_pw_min_us, line.pw_min_us),
      pick(line.engineered_pw_max_us, line.pw_max_us),
    );
    if (t === "fixed") {
      add(
        "pri",
        t,
        pick(line.engineered_pri_min_us, line.pri_min_us),
        pick(line.engineered_pri_max_us, line.pri_max_us),
      );
      add("jitter", t, line.jitter_min_us ?? null, line.jitter_max_us ?? null);
    } else {
      add(
        "frame",
        t,
        pick(line.engineered_frame_time_min_us, line.frame_time_us),
        pick(line.engineered_frame_time_max_us, line.frame_time_us),
      );
    }
  }
  for (const param of Object.keys(raw) as ChartParam[]) {
    for (const t of Object.keys(raw[param]) as ReportPriType[])
      raw[param][t] = merge(raw[param][t]!);
  }
  return raw;
}

/** One report's value(s) for a parameter — several for stagger positions. */
export function reportValues(r: CsvReport, param: ChartParam): number[] {
  switch (param) {
    case "rf":
      return [r.rfMhz];
    case "pri":
      return r.priType === "fixed" && r.priUs != null ? [r.priUs] : [];
    case "frame":
      return r.priType === "stagger" && r.priUs != null ? [r.priUs] : [];
    case "pw":
      return r.pwUs != null ? [r.pwUs] : [];
    case "jitter":
      return r.priType === "fixed" && r.jitterUs != null ? [r.jitterUs] : [];
    case "stagger":
      return r.staggerUs ?? [];
  }
}

/** All intervals for a parameter regardless of PRI type — for drawing where
 * Modes reach under a chart. */
export function allIntervals(
  byType: Partial<Record<ReportPriType, Interval[]>>,
): Interval[] {
  return merge(
    Object.values(byType)
      .flatMap((v) => v ?? [])
      .map(([a, b]) => [a, b] as Interval),
  );
}
