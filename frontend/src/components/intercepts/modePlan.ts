/** The planning page's arithmetic: what range each entry would give a new
 * Mode, how far an existing Mode would have to grow to cover it, and how
 * many of the entry's reports each result covers. Pure functions, so the
 * page only shows what these return — and sends exactly that. */
import type { InterceptEntry, Mode, ModeLineFields } from "../../types/domain";
import { matchEntry, type MatchParam } from "./interceptMatch";

export type Range = [number, number];

/** Where a range comes from: every report, or the middle 98% (1st–99th percentile). */
export type RangeBasis = "minmax" | "p98";

export interface PlanSettings {
  basis: RangeBasis;
  rfDelta: number;
  priDelta: number;
  frameDelta: number;
  pwDelta: number;
  /** A CW entry has no pulses; a CW Mode still needs a PW range. */
  cwPw: Range | null;
}

/** One entry's report values, sorted — for percentiles and coverage. */
export interface EntryReports {
  rf: number[];
  pri: number[];
  pw: number[];
  jitter: number[];
  /** Each report's value set for coverage: RF, PRI (frame time), PW, positions. */
  points: { rf: number; pri: number | null; pw: number | null; positions: number }[];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function quantile(sorted: number[], p: number) {
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

function fromValues(sorted: number[], basis: RangeBasis): Range | null {
  if (sorted.length === 0) return null;
  if (basis === "minmax" || sorted.length < 3) return [sorted[0], sorted[sorted.length - 1]];
  return [r3(quantile(sorted, 0.01)), r3(quantile(sorted, 0.99))];
}

function fromEntry(min: number | null | undefined, max: number | null | undefined, mean: number | null): Range | null {
  if (mean == null) return null;
  return [min ?? mean, max ?? mean];
}

export interface EntryRanges {
  rf: Range;
  /** PRI for fixed; the frame time for a stagger; null for CW. */
  pri: Range | null;
  pw: Range | null;
  jitter: Range | null;
  /** False when the entry has no reports kept — its own min/max are used. */
  fromReports: boolean;
}

/** The entry's measured ranges on the chosen basis. */
export function entryRanges(entry: InterceptEntry, reports: EntryReports | undefined, basis: RangeBasis): EntryRanges {
  if (reports && reports.rf.length > 0) {
    return {
      rf: fromValues(reports.rf, basis)!,
      pri: entry.pri_type === "cw" ? null : fromValues(reports.pri, basis),
      pw: entry.pri_type === "cw" ? null : fromValues(reports.pw, basis),
      jitter: entry.pri_type === "fixed" ? fromValues(reports.jitter, basis) : null,
      fromReports: true,
    };
  }
  const jitter = entry.jitter_mean_us ?? null;
  return {
    rf: fromEntry(entry.rf_min_mhz, entry.rf_max_mhz, entry.rf_mean_mhz)!,
    pri: entry.pri_type === "cw" ? null : fromEntry(entry.pri_min_us, entry.pri_max_us, entry.pri_mean_us),
    pw: entry.pri_type === "cw" ? null : fromEntry(entry.pw_min_us, entry.pw_max_us, entry.pw_mean_us),
    jitter: entry.pri_type === "fixed" && jitter != null ? [jitter, jitter] : null,
    fromReports: false,
  };
}

/** The ranges a Mode covers — what matching compares with. */
export interface Coverage {
  rf: Range | null;
  pri: Range | null;
  pw: Range | null;
  /** A stagger's number of positions; 0 when not a stagger. */
  positions: number;
}

const widen = (r: Range | null, d: number | null | undefined): Range | null =>
  r == null ? null : [r3(r[0] - (d ?? 0)), r3(r[1] + (d ?? 0))];
const pair = (lo: number | null | undefined, hi: number | null | undefined): Range | null =>
  lo == null || hi == null ? null : [lo, hi];

/** A stagger's frame time: the one written in, or the sum of its positions. */
function frameTime(line: Pick<ModeLineFields, "pri_stagger_values_us" | "explicit_frame_time_us">) {
  if (line.explicit_frame_time_us != null) return line.explicit_frame_time_us;
  const v = line.pri_stagger_values_us ?? [];
  return v.length ? r3(v.reduce((a, b) => a + b, 0)) : null;
}

/** What a line covers: its raw ranges widened by its deltas. */
export function lineCoverage(priType: string, line: ModeLineFields): Coverage {
  const rf = widen([line.rf_min_mhz, line.rf_max_mhz], line.rf_delta);
  if (priType === "cw") return { rf, pri: null, pw: null, positions: 0 };
  const pw = widen([line.pw_min_us, line.pw_max_us], line.pw_delta);
  if (priType === "stagger") {
    const ft = frameTime(line);
    return {
      rf,
      pri: ft == null ? null : widen([ft, ft], line.frame_time_delta_us),
      pw,
      positions: line.pri_stagger_values_us?.length ?? 0,
    };
  }
  return { rf, pri: widen(pair(line.pri_min_us, line.pri_max_us), line.pri_delta), pw, positions: 0 };
}

/** How many of an entry's reports fall inside — null when it has none kept. */
export function coveredShare(reports: EntryReports | undefined, priType: string, c: Coverage): number | null {
  if (!reports || reports.points.length === 0) return null;
  const inside = (v: number | null, r: Range | null) => r == null || v == null || (v >= r[0] - 1e-9 && v <= r[1] + 1e-9);
  let n = 0;
  for (const p of reports.points) {
    if (!inside(p.rf, c.rf)) continue;
    if (priType !== "cw") {
      if (!inside(p.pri, c.pri) || !inside(p.pw, c.pw)) continue;
      if (priType === "stagger" && c.positions > 0 && p.positions > 0 && p.positions !== c.positions) continue;
    }
    n++;
  }
  return n / reports.points.length;
}

/** A new Mode's line from an entry: its ranges, with the deltas on top. A
 * stagger's frame time is one value with a ± delta, so its measured spread
 * goes into that delta. */
export function newModeLine(entry: InterceptEntry, ranges: EntryRanges, s: PlanSettings): ModeLineFields | null {
  const base = {
    rf_min_mhz: ranges.rf[0],
    rf_max_mhz: ranges.rf[1],
    rf_delta: s.rfDelta,
    pw_delta: s.pwDelta,
    rf_range_matching: false,
    pw_range_matching: false,
    pri_range_matching: false,
  };
  if (entry.pri_type === "cw") {
    if (!s.cwPw) return null;
    return { ...base, pw_min_us: s.cwPw[0], pw_max_us: s.cwPw[1] };
  }
  if (!ranges.pw) return null;
  const pulsed = { ...base, pw_min_us: ranges.pw[0], pw_max_us: ranges.pw[1] };
  if (entry.pri_type === "fixed") {
    if (!ranges.pri) return null;
    return {
      ...pulsed,
      pri_min_us: ranges.pri[0],
      pri_max_us: ranges.pri[1],
      pri_delta: s.priDelta,
      jitter_min_us: ranges.jitter?.[0] ?? 0,
      jitter_max_us: ranges.jitter?.[1] ?? 0,
    };
  }
  const values = entry.stagger_values ?? [];
  if (values.length === 0) return null;
  const sum = r3(values.reduce((a, b) => a + b, 0));
  const centre = entry.pri_mean_us ?? sum;
  const spread = ranges.pri ? Math.max(Math.abs(ranges.pri[0] - centre), Math.abs(ranges.pri[1] - centre)) : 0;
  return {
    ...pulsed,
    pri_stagger_values_us: values,
    explicit_frame_time_us: Math.abs(centre - sum) > 0.0005 ? r3(centre) : null,
    frame_time_delta_us: r3(s.frameDelta + spread),
  };
}

/** The fields a widening changes — only ranges, only ever bigger. */
export interface WidenChange {
  rf_min_mhz?: number;
  rf_max_mhz?: number;
  pri_min_us?: number;
  pri_max_us?: number;
  pw_min_us?: number;
  pw_max_us?: number;
  frame_time_delta_us?: number;
}

/** A Mode an entry could widen: it matches on all but `param`. */
export interface WidenOption {
  mode: Mode;
  param: MatchParam;
  /** How much the parameter's covered range grows, as a share of what it is now. */
  growth: number;
}

/** Grows a Mode's raw range on one parameter to take in the entry's range
 * (its deltas then apply on top, as for a new Mode). A stagger's frame time
 * grows by its delta. Null when it can't: a stagger with a different number
 * of positions, or a Mode with nothing on that parameter. */
export function widenChange(mode: Mode, param: MatchParam, ranges: EntryRanges): WidenChange | null {
  const line = mode.line;
  if (!line) return null;
  const grow = (cur: Range | null, want: Range | null): Range | null =>
    cur && want ? [Math.min(cur[0], want[0]), Math.max(cur[1], want[1])] : null;
  if (param === "RF") {
    const g = grow([line.rf_min_mhz, line.rf_max_mhz], ranges.rf);
    return g && { rf_min_mhz: g[0], rf_max_mhz: g[1] };
  }
  if (param === "PW") {
    const g = grow([line.pw_min_us, line.pw_max_us], ranges.pw);
    return g && { pw_min_us: g[0], pw_max_us: g[1] };
  }
  if (mode.pri_type === "stagger") {
    const ft = frameTime(line);
    if (ft == null || !ranges.pri) return null;
    const need = Math.max(Math.abs(ranges.pri[0] - ft), Math.abs(ranges.pri[1] - ft));
    return { frame_time_delta_us: r3(Math.max(line.frame_time_delta_us ?? 0, need)) };
  }
  const g = grow(pair(line.pri_min_us, line.pri_max_us), ranges.pri);
  return g && { pri_min_us: g[0], pri_max_us: g[1] };
}

/** Several entries widening one Mode: the widest of each field. */
export function mergeChanges(changes: WidenChange[]): WidenChange {
  const out: WidenChange = {};
  for (const c of changes) {
    for (const [k, v] of Object.entries(c) as [keyof WidenChange, number][]) {
      const cur = out[k];
      const isLow = k.endsWith("_min_mhz") || k.endsWith("_min_us");
      out[k] = cur == null ? v : isLow ? Math.min(cur, v) : Math.max(cur, v);
    }
  }
  return out;
}

/** The Mode's line with a widening applied. */
export function applyChange(line: ModeLineFields, change: WidenChange): ModeLineFields {
  return { ...line, ...change };
}

/** The Modes an entry could widen, smallest growth first. A stagger whose
 * positions differ can't be widened into — the count isn't a range. */
export function widenOptions(entry: InterceptEntry, modes: Mode[], ranges: EntryRanges): WidenOption[] {
  const m = matchEntry(entry, modes);
  if (m.status !== "near") return [];
  const out: WidenOption[] = [];
  for (const { mode, misses } of m.near) {
    const miss = misses[0];
    if (!miss || miss.positions || !mode.line) continue;
    const change = widenChange(mode, miss.param, ranges);
    if (!change) continue;
    const before = lineCoverage(mode.pri_type, mode.line);
    const after = lineCoverage(mode.pri_type, applyChange(mode.line, change));
    const key = miss.param === "RF" ? "rf" : miss.param === "PW" ? "pw" : "pri";
    const b = before[key];
    const a = after[key];
    const width = b ? Math.max(b[1] - b[0], 1e-9) : 1;
    const growth = a && b ? (a[1] - a[0] - (b[1] - b[0])) / width : Infinity;
    out.push({ mode, param: miss.param, growth });
  }
  return out.sort((x, y) => x.growth - y.growth);
}

/** "1–1.2 → 1–2.031" — a parameter's covered range before and after. */
export function describeRange(r: Range | null, unit = "") {
  if (!r) return "—";
  const [a, b] = r.map((v) => Number(v.toFixed(3)));
  return `${a === b ? a : `${a}–${b}`}${unit ? ` ${unit}` : ""}`;
}
