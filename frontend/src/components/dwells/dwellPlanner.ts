/** The dwell planner: for each of a Platform's Modes, how a Strategy's dwells
 * cover it and how likely it is to be intercepted — and what to change.
 * Pure (no React, no API), so it can be tested on its own.
 *
 * Units: frequencies in MHz, receiver times in ms, PRI in µs, scan periods in s.
 *
 * The model, kept deliberately simple and said so on the page:
 * - A Mode is seen when the receiver sits on its frequency long enough to
 *   collect `pulses` pulses — within one dwell, or within one collect if the
 *   receiver needs them in a single collect. That's `pulses` × its longest
 *   gap between pulses (a Fixed PRI's longest, with its jitter; a stagger's
 *   longest step) — a stagger also needs two whole frames, to see the
 *   sequence repeat. A CW Mode needs one collect.
 * - Its frequency is anywhere in its RF range (with its delta), so each part
 *   of that range counts by its width: a part no dwell reaches is never seen.
 * - A Mode with a scan period illuminates the Platform once each scan, for
 *   its operational mode's illumination time where that's set, else its
 *   Emitter's, else (beamwidth ÷ 360°) of the scan; one without a scan period, all the time. The scan period is
 *   the Mode's own box (its function's) where it has one, else its EW Group's
 *   overall range.
 * - The receiver repeats the cycle; the radar's scan starts at any moment.
 *   Each Mode is played against the cycle from many starting phases: the
 *   share caught within the time allowed, and how soon. Phases never caught
 *   at all while others are — the cycle and the scan keep missing each other —
 *   is synchronism. */

export interface PlannerDwell {
  freq_mhz: number;
  dwell_time_ms: number;
  collect_time_ms: number;
}

export interface PlannerMode {
  key: string;
  emitterId: string;
  emitterName: string;
  modeName: string;
  priType: string;
  /** RF range with its delta, MHz. */
  rf: [number, number];
  /** Longest gap between pulses, µs (null: CW, or not known). */
  longestIntervalUs: number | null;
  /** A stagger's longest frame time, µs. */
  frameUs: number | null;
  /** Its scan period, s: its own box, or its EW Group's range (null: not scanning — on the Platform all the time). */
  scanS: [number, number] | null;
  /** Where scanS comes from: the Mode's own box or its EW Group's range. */
  scanFrom?: "mode" | "group" | null;
  /** Its EW Group's overall scan range, s — the box should sit inside it. */
  groupScanS?: [number, number] | null;
  /** Its Emitter's illumination time, ms, where set (else worked out from the beamwidth). */
  illuminationTimeMs?: number | null;
  /** The radar's operational mode it's transmitted in, and that mode's illumination time, ms (ahead of the Emitter's). */
  operationalMode?: string | null;
  operationalIlluminationMs?: number | null;
  priority: number | null;
  confirmationQuantity: number | null;
}

export interface PlannerSettings {
  /** Pulses the receiver needs to detect a Mode. */
  pulses: number;
  /** Where those pulses must fall: anywhere in one dwell, or in one collect. */
  within: "dwell" | "collect";
  /** Antenna beamwidth of the scanning radars, degrees. */
  beamwidthDeg: number;
  /** The time allowed to intercept, s. */
  horizonS: number;
}

export const DEFAULT_SETTINGS: PlannerSettings = { pulses: 8, within: "dwell", beamwidthDeg: 3, horizonS: 10 };

export type Issue = "not_covered" | "partly_covered" | "too_short" | "illumination_too_short" | "synchronism" | "slow" | "ok";

export interface ModePlan {
  mode: PlannerMode;
  /** Share of its RF range the dwell bands reach, 0–1. */
  coverage: number;
  /** The dwells (0-based) whose band reaches it. */
  covering: number[];
  /** Time it needs on frequency to be seen, ms. */
  needMs: number;
  /** The shortest dwell (or collect) that's long enough: `needMs` rounded up to whole collects. */
  recommendedMs: number | null;
  /** How often a long-enough look at it comes round, ms (the longest gap); null: never. */
  revisitMs: number | null;
  /** Its illumination time: how long its main beam is on the Platform each scan, ms (null: all the time). */
  illuminationMs: number | null;
  /** Where that comes from: its operational mode's, its Emitter's, or worked out from the beamwidth. */
  illuminationFrom: "operational" | "emitter" | "beamwidth" | null;
  /** Share of starting phases (weighted by RF) caught within the time allowed. */
  pWithin: number;
  /** …and confirmed (its confirmation quantity of intercepts) within it. */
  pConfirm: number;
  /** Median time to the first intercept, ms (Infinity: half or more never caught). */
  medianMs: number;
  /** Share of starting phases never caught, however long (weighted), when others are. */
  lockedOut: number;
  issue: Issue;
}

const EPS = 1e-9;

/** A dwell's band: its frequency ± half the bandwidth. */
export const band = (d: PlannerDwell, bw: number): [number, number] => [d.freq_mhz - bw / 2, d.freq_mhz + bw / 2];

/** Rounded up to a whole number of collects (as the receiver needs it). */
export function wholeCollects(ms: number, collectMs: number): number {
  if (!(collectMs > 0)) return ms;
  const n = Math.ceil(ms / collectMs - 1e-9);
  return Math.max(1, n) * collectMs;
}

export function isWholeCollects(d: PlannerDwell): boolean {
  if (!(d.collect_time_ms > 0)) return true;
  const n = d.dwell_time_ms / d.collect_time_ms;
  return Math.abs(n - Math.round(n)) < 1e-6;
}

/** Time a Mode needs on frequency to be seen, ms. */
export function needMs(m: PlannerMode, s: PlannerSettings, collectMs: number): number {
  if (m.priType === "cw" || m.longestIntervalUs == null) return collectMs > 0 ? collectMs : 1;
  let us = s.pulses * m.longestIntervalUs;
  if (m.priType === "stagger" && m.frameUs != null) us = Math.max(us, 2 * m.frameUs);
  return us / 1000;
}

interface Window {
  start: number;
  length: number;
}

/** The parts of [lo, hi] each with the same set of dwells reaching it, and their width. */
function segments(rf: [number, number], dwells: PlannerDwell[], bw: number): { covering: number[]; width: number }[] {
  const [lo, hi] = rf;
  if (hi - lo < EPS) {
    return [{ covering: dwells.flatMap((d, i) => (band(d, bw)[0] <= lo + EPS && lo <= band(d, bw)[1] + EPS ? [i] : [])), width: 1 }];
  }
  const cuts = new Set([lo, hi]);
  for (const d of dwells) for (const e of band(d, bw)) if (e > lo && e < hi) cuts.add(e);
  const xs = [...cuts].sort((a, b) => a - b);
  const out: { covering: number[]; width: number }[] = [];
  for (let k = 0; k + 1 < xs.length; k++) {
    const mid = (xs[k] + xs[k + 1]) / 2;
    const covering = dwells.flatMap((d, i) => {
      const [a, b] = band(d, bw);
      return a <= mid && mid <= b ? [i] : [];
    });
    const key = covering.join(",");
    const last = out[out.length - 1];
    if (last && last.covering.join(",") === key) last.width += xs[k + 1] - xs[k];
    else out.push({ covering, width: xs[k + 1] - xs[k] });
  }
  return out;
}

/** The looks at a Mode in one cycle long enough to see it. */
function windows(dwells: PlannerDwell[], starts: number[], covering: number[], need: number, within: PlannerSettings["within"]): Window[] {
  const out: Window[] = [];
  for (const i of covering) {
    const d = dwells[i];
    if (within === "collect" && d.collect_time_ms > 0) {
      const n = Math.floor(d.dwell_time_ms / d.collect_time_ms + 1e-9);
      if (d.collect_time_ms + EPS < need) continue;
      for (let k = 0; k < n; k++) out.push({ start: starts[i] + k * d.collect_time_ms, length: d.collect_time_ms });
    } else if (d.dwell_time_ms + EPS >= need) out.push({ start: starts[i], length: d.dwell_time_ms });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The longest wait between the starts of two looks, cycle round. */
function longestGap(ws: Window[], cycle: number): number | null {
  if (!ws.length) return null;
  let gap = 0;
  for (let k = 0; k < ws.length; k++) {
    const next = k + 1 < ws.length ? ws[k + 1].start : ws[0].start + cycle;
    gap = Math.max(gap, next - ws[k].start);
  }
  return gap;
}

/** When a look of length ≥ need fits inside [a, b] first — the time it
 * completes, and when that look ends — or null. The looks repeat every cycle. */
function firstHit(a: number, b: number, ws: Window[], cycle: number, need: number): { t: number; end: number } | null {
  let best: { t: number; end: number } | null = null;
  for (const w of ws) {
    const nLo = Math.floor((a - w.start - w.length) / cycle);
    const nHi = Math.ceil((b - w.start) / cycle);
    for (let n = Math.max(nLo, 0); n <= nHi; n++) {
      const s = Math.max(a, w.start + n * cycle);
      const e = Math.min(b, w.start + n * cycle + w.length);
      if (e - s + EPS >= need) {
        const t = s + need;
        if (best == null || t < best.t) best = { t, end: w.start + n * cycle + w.length };
        break;
      }
    }
  }
  return best;
}

const PHASES = 72;

/** From each starting phase: when the first and the q-th intercept come
 * (Infinity if not within `limit`). */
function play(ws: Window[], cycle: number, need: number, illumination: number | null, periodMs: number | null, q: number, limit: number) {
  const first: number[] = [];
  const confirm: number[] = [];
  if (illumination == null || periodMs == null) {
    // On the Platform all the time: the phase is where in the cycle we start.
    for (let j = 0; j < PHASES; j++) {
      const t0 = ((j + 0.5) / PHASES) * cycle;
      const hits: number[] = [];
      let from = t0;
      while (hits.length < q && from - t0 < limit) {
        const hit = firstHit(from, from + cycle * 2, ws, cycle, need);
        if (hit == null) break;
        hits.push(hit.t - t0);
        from = hit.end; // one intercept a look: the next comes from the next look
      }
      first.push(hits[0] ?? Infinity);
      confirm.push(hits.length >= q ? hits[q - 1] : Infinity);
    }
    return { first, confirm };
  }
  for (let j = 0; j < PHASES; j++) {
    const phase = ((j + 0.5) / PHASES) * periodMs;
    const hits: number[] = [];
    for (let a = phase - periodMs; a < limit && hits.length < q; a += periodMs) {
      const s = Math.max(a, 0);
      const e = a + illumination;
      if (e - s + EPS < need) continue;
      const hit = firstHit(s, e, ws, cycle, need);
      if (hit != null) hits.push(hit.t);
    }
    first.push(hits[0] ?? Infinity);
    confirm.push(hits.length >= q ? hits[q - 1] : Infinity);
  }
  return { first, confirm };
}

function weightedMedian(samples: { t: number; w: number }[]): number {
  const total = samples.reduce((n, s) => n + s.w, 0);
  if (total <= 0) return Infinity;
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  let acc = 0;
  for (const s of sorted) {
    acc += s.w;
    if (acc >= total / 2 - EPS) return s.t;
  }
  return Infinity;
}

/** The scan periods to try: its range's ends and middle (one if fixed). */
function periods(scanS: [number, number] | null): number[] | null {
  if (!scanS) return null;
  const [a, b] = scanS.map((x) => x * 1000);
  if (!(b > 0)) return null;
  return b - a < EPS ? [b] : [Math.max(a, EPS), (a + b) / 2, b];
}

/** One Mode against the dwells. */
export function planMode(m: PlannerMode, dwells: PlannerDwell[], bw: number, s: PlannerSettings): ModePlan {
  const starts: number[] = [];
  let cycle = 0;
  for (const d of dwells) {
    starts.push(cycle);
    cycle += d.dwell_time_ms;
  }
  const collect = commonCollect(dwells);
  const need = needMs(m, s, collect);
  const segs = segments(m.rf, dwells, bw);
  const total = segs.reduce((n, g) => n + g.width, 0) || 1;
  const covered = segs.filter((g) => g.covering.length).reduce((n, g) => n + g.width, 0);
  const coverage = covered / total;
  const covering = [...new Set(segs.flatMap((g) => g.covering))].sort((a, b) => a - b);
  const q = Math.max(1, m.confirmationQuantity ?? 1);
  const horizon = s.horizonS * 1000;
  const ps = periods(m.scanS);
  const set = (v: number | null | undefined) => (v != null && v > 0 ? v : null);
  const fromOperational = set(m.operationalIlluminationMs);
  const own = fromOperational ?? set(m.illuminationTimeMs);
  // Never longer than the scan itself.
  const illuminationOf = (T: number) => Math.min(T, own ?? (T * s.beamwidthDeg) / 360);
  const recommendedMs = covering.length || coverage === 0 ? wholeCollects(need, s.within === "collect" ? 0 : collect) : null;

  // Worst over the scan periods it may have; each scored over its RF parts.
  let worst: { pWithin: number; pConfirm: number; median: number; lockedOut: number; revisit: number | null; illumination: number | null } | null = null;
  for (const T of ps ?? [null]) {
    const illumination = T == null ? null : illuminationOf(T);
    const longLimit = Math.min(600_000, Math.max(horizon, 40 * Math.max(T ?? 0, cycle)));
    const samples: { t: number; w: number }[] = [];
    let pWithin = 0;
    let pConfirm = 0;
    let lockedOut = 0;
    let revisit: number | null = null;
    for (const g of segs) {
      const w = g.width / total;
      const ws = cycle > 0 ? windows(dwells, starts, g.covering, need, s.within) : [];
      const gap = longestGap(ws, cycle);
      if (gap != null) revisit = revisit == null ? gap : Math.max(revisit, gap);
      if (!ws.length || (illumination != null && illumination + EPS < need)) {
        samples.push({ t: Infinity, w });
        continue;
      }
      const { first, confirm } = play(ws, cycle, need, illumination, T, q, longLimit);
      const share = w / first.length;
      const caughtAtAll = first.some((t) => Number.isFinite(t));
      for (let k = 0; k < first.length; k++) {
        samples.push({ t: first[k], w: share });
        if (first[k] <= horizon) pWithin += share;
        if (confirm[k] <= horizon) pConfirm += share;
        if (!Number.isFinite(first[k]) && caughtAtAll) lockedOut += share;
      }
    }
    const median = weightedMedian(samples);
    const r = { pWithin, pConfirm, median, lockedOut, revisit, illumination };
    if (!worst || r.pWithin < worst.pWithin - EPS) worst = r;
  }
  const w = worst!;

  const anyUsable = covering.some((i) => {
    const d = dwells[i];
    return (s.within === "collect" && d.collect_time_ms > 0 ? d.collect_time_ms : d.dwell_time_ms) + EPS >= need;
  });
  let issue: Issue = "ok";
  if (coverage === 0) issue = "not_covered";
  else if (!anyUsable) issue = "too_short";
  else if (w.illumination != null && w.illumination + EPS < need) issue = "illumination_too_short";
  else if (w.lockedOut > 0.02) issue = "synchronism";
  else if (coverage < 1 - EPS) issue = "partly_covered";
  else if (w.pWithin < 0.9) issue = "slow";

  return {
    mode: m,
    coverage,
    covering,
    needMs: need,
    recommendedMs,
    revisitMs: w.revisit,
    illuminationMs: w.illumination,
    illuminationFrom: w.illumination == null ? null : fromOperational != null ? "operational" : own != null ? "emitter" : "beamwidth",
    pWithin: w.pWithin,
    pConfirm: w.pConfirm,
    medianMs: w.median,
    lockedOut: w.lockedOut,
    issue,
  };
}

const ISSUE_ORDER: Issue[] = ["not_covered", "too_short", "illumination_too_short", "synchronism", "partly_covered", "slow", "ok"];

/** Every Mode against the dwells, problems first. */
export function plan(modes: PlannerMode[], dwells: PlannerDwell[], bw: number, s: PlannerSettings): ModePlan[] {
  const usable = dwells.filter((d) => d.freq_mhz > 0 && d.dwell_time_ms > 0);
  return modes
    .map((m) => planMode(m, usable, bw, s))
    .sort(
      (a, b) =>
        ISSUE_ORDER.indexOf(a.issue) - ISSUE_ORDER.indexOf(b.issue) ||
        a.pWithin - b.pWithin ||
        a.mode.emitterName.localeCompare(b.mode.emitterName, undefined, { numeric: true }) ||
        a.mode.modeName.localeCompare(b.mode.modeName, undefined, { numeric: true }),
    );
}

/** The collect time most of the dwells use (50 ms when none). */
export function commonCollect(dwells: PlannerDwell[]): number {
  const counts = new Map<number, number>();
  for (const d of dwells) if (d.collect_time_ms > 0) counts.set(d.collect_time_ms, (counts.get(d.collect_time_ms) ?? 0) + 1);
  let best = 50;
  let n = 0;
  for (const [c, k] of counts) if (k > n) [best, n] = [c, k];
  return best;
}

// --- What to change ------------------------------------------------------------

/** Every dwell time rounded up to a whole number of its collects. */
export function roundToCollects(dwells: PlannerDwell[]): PlannerDwell[] {
  return dwells.map((d) => (isWholeCollects(d) ? d : { ...d, dwell_time_ms: wholeCollects(d.dwell_time_ms, d.collect_time_ms) }));
}

/** Each dwell long enough for every Mode it reaches (whole collects); in
 * "collect" mode, each collect long enough, the dwell a whole number of them. */
export function lengthenShort(dwells: PlannerDwell[], plans: ModePlan[], s: PlannerSettings): PlannerDwell[] {
  const needed = new Map<number, number>();
  for (const p of plans) for (const i of p.covering) needed.set(i, Math.max(needed.get(i) ?? 0, p.needMs));
  return dwells.map((d, i) => {
    const need = needed.get(i);
    if (need == null) return d;
    if (s.within === "collect" && d.collect_time_ms > 0) {
      if (d.collect_time_ms + EPS >= need) return d;
      const collect = Math.ceil(need);
      return { ...d, collect_time_ms: collect, dwell_time_ms: wholeCollects(Math.max(d.dwell_time_ms, collect), collect) };
    }
    if (d.dwell_time_ms + EPS >= need) return d;
    return { ...d, dwell_time_ms: wholeCollects(need, d.collect_time_ms) };
  });
}

/** Dwells for the RF no dwell reaches: bands side by side across each gap,
 * each long enough for the Modes there, added at the end of the cycle. */
export function addForUncovered(dwells: PlannerDwell[], plans: ModePlan[], bw: number, s: PlannerSettings): PlannerDwell[] {
  const collect = commonCollect(dwells);
  const gaps: { lo: number; hi: number; need: number }[] = [];
  for (const p of plans) {
    if (p.coverage >= 1 - EPS) continue;
    for (const g of uncoveredParts(p.mode.rf, dwells, bw)) gaps.push({ ...g, need: p.needMs });
  }
  gaps.sort((a, b) => a.lo - b.lo);
  // Overlapping gaps merged, keeping the longest need.
  const merged: typeof gaps = [];
  for (const g of gaps) {
    const last = merged[merged.length - 1];
    if (last && g.lo <= last.hi + EPS) {
      last.hi = Math.max(last.hi, g.hi);
      last.need = Math.max(last.need, g.need);
    } else merged.push({ ...g });
  }
  const added: PlannerDwell[] = [];
  for (const g of merged) {
    const time = s.within === "collect" ? wholeCollects(Math.max(collect, g.need), Math.max(collect, Math.ceil(g.need))) : wholeCollects(g.need, collect);
    const c = s.within === "collect" ? Math.max(collect, Math.ceil(g.need)) : collect;
    for (let f = g.lo + bw / 2; f - bw / 2 < g.hi - EPS; f += bw) {
      added.push({ freq_mhz: Math.round(f * 1000) / 1000, dwell_time_ms: time, collect_time_ms: c });
    }
  }
  return [...dwells, ...added];
}

/** The parts of an RF range no dwell's band reaches. */
export function uncoveredParts(rf: [number, number], dwells: PlannerDwell[], bw: number): { lo: number; hi: number }[] {
  let parts = [{ lo: rf[0], hi: rf[1] }];
  for (const d of dwells) {
    const [a, b] = band(d, bw);
    parts = parts.flatMap((p) => {
      if (b < p.lo || a > p.hi) return [p];
      const out: { lo: number; hi: number }[] = [];
      if (a > p.lo) out.push({ lo: p.lo, hi: a });
      if (b < p.hi) out.push({ lo: b, hi: p.hi });
      return out;
    });
  }
  return parts.filter((p) => p.hi - p.lo > EPS || rf[1] - rf[0] < EPS);
}

/** A score for a whole plan: the share of every Mode caught in time. */
export function score(plans: ModePlan[]): number {
  return plans.reduce((n, p) => n + p.pWithin, 0);
}

/** Tries one collect more on each dwell, keeps the one that helps most —
 * what breaks a cycle out of step with a scan. Null when none helps. */
export function breakSynchronism(
  modes: PlannerMode[],
  dwells: PlannerDwell[],
  bw: number,
  s: PlannerSettings,
): { dwells: PlannerDwell[]; changed: number; gain: number } | null {
  const base = score(plan(modes, dwells, bw, s));
  let best: { dwells: PlannerDwell[]; changed: number; gain: number } | null = null;
  dwells.forEach((d, i) => {
    const step = d.collect_time_ms > 0 ? d.collect_time_ms : 10;
    const next = dwells.map((x, j) => (j === i ? { ...x, dwell_time_ms: x.dwell_time_ms + step } : x));
    const gain = score(plan(modes, next, bw, s)) - base;
    if (gain > 0.01 && (!best || gain > best.gain)) best = { dwells: next, changed: i, gain };
  });
  return best;
}
