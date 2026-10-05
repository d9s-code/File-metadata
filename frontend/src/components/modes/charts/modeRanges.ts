import type { Mode, TestResult } from "../../../types/domain";

export type Span = [number, number];

/** A Mode's ranges for the charts: what it was set to (raw) and what the
 * system recognises (engineered, raw ± delta). PRI is the frame time for a
 * stagger and absent for CW and X-let. */
export interface ModeRanges {
  mode: Mode;
  rf: Span;
  rfRaw: Span;
  pri: Span | null;
  priRaw: Span | null;
  pw: Span | null;
  pwRaw: Span | null;
}

const span = (lo: number | null | undefined, hi: number | null | undefined): Span | null =>
  lo == null || hi == null ? null : [Math.min(lo, hi), Math.max(lo, hi)];

export function modeRanges(mode: Mode): ModeRanges | null {
  const l = mode.line;
  if (!l) return null;
  const rfRaw = span(l.rf_min_mhz, l.rf_max_mhz);
  if (!rfRaw) return null;
  const rf = span(l.engineered_rf_min_mhz, l.engineered_rf_max_mhz) ?? rfRaw;
  const pwRaw = mode.pri_type === "cw" ? null : span(l.pw_min_us, l.pw_max_us);
  const pw = mode.pri_type === "cw" ? null : (span(l.engineered_pw_min_us, l.engineered_pw_max_us) ?? pwRaw);
  let pri: Span | null = null;
  let priRaw: Span | null = null;
  if (mode.pri_type === "fixed") {
    priRaw = span(l.pri_min_us, l.pri_max_us);
    pri = span(l.engineered_pri_min_us, l.engineered_pri_max_us) ?? priRaw;
  } else if (mode.pri_type === "stagger") {
    priRaw = span(l.frame_time_us, l.frame_time_us);
    pri = span(l.engineered_frame_time_min_us, l.engineered_frame_time_max_us) ?? priRaw;
  }
  return { mode, rf, rfRaw, pri, priRaw, pw, pwRaw };
}

/** Last test result as a status, with its label — never colour alone. */
export const RESULT_STATUS: Record<TestResult | "untested", { cls: string; label: string }> = {
  pass: { cls: "status-good", label: "Passed" },
  partial: { cls: "status-warning", label: "Partial" },
  fail: { cls: "status-critical", label: "Failed" },
  inconclusive: { cls: "status-neutral", label: "Inconclusive" },
  untested: { cls: "status-neutral", label: "Untested" },
};

export function resultStatus(mode: Mode) {
  return RESULT_STATUS[mode.last_test_result ?? "untested"];
}

/** The union of spans, padded a little, for an axis. */
export function domainOf(spans: (Span | null | undefined)[], extra: number[] = []): Span {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of spans) {
    if (!s) continue;
    lo = Math.min(lo, s[0]);
    hi = Math.max(hi, s[1]);
  }
  for (const v of extra) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (!Number.isFinite(lo)) return [0, 1];
  const pad = (hi - lo) * 0.04 || Math.max(Math.abs(lo) * 0.01, 1);
  return [lo - pad, hi + pad];
}

export type ChartParam = "rf" | "pri" | "pw";

/** Axis bounds the user set for a parameter; a side left unset fits the data. */
export interface AxisLimit {
  min?: number;
  max?: number;
}
export type AxisLimits = Partial<Record<ChartParam, AxisLimit>>;

/** An axis from what fits the data, overridden by the user's bounds. Only one
 * bound set and it's past the other end of the data: keep the data's width. */
export function withLimits(auto: Span, limit: AxisLimit | undefined): Span {
  if (!limit) return auto;
  const lo = limit.min ?? auto[0];
  const hi = limit.max ?? auto[1];
  if (lo < hi) return [lo, hi];
  const width = auto[1] - auto[0] || 1;
  if (limit.min != null && limit.max == null) return [lo, lo + width];
  if (limit.max != null && limit.min == null) return [hi - width, hi];
  return auto;
}

/** How a Mode is painted: a colour class, and what that colour stands for. */
export type Paint = (mode: Mode) => { cls: string; label: string };

/** How many Modes can have a colour of their own at once — beyond eight,
 * colours stop being told apart reliably, so the rest stay grey. */
export const SERIES_SLOTS = 8;

/** An intercept entry as the charts draw it. */
export interface ChartEntry {
  rf: number;
  /** PRI, or a stagger's frame time; null for CW. */
  pri: number | null;
  pw: number | null;
  matched: boolean;
  label: string;
}

export const spanOf = (r: ModeRanges, p: ChartParam): Span | null => (p === "rf" ? r.rf : p === "pri" ? r.pri : r.pw);
export const valueOf = (e: ChartEntry, p: ChartParam): number | null => (p === "rf" ? e.rf : p === "pri" ? e.pri : e.pw);
