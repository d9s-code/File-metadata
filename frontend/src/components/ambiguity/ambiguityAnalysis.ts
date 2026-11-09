import type { AmbiguityFinding, AmbiguitySeverity, ComparedSide, FindingModeSide, OverlapParam } from "../../api/ambiguity";
import type { LineValues } from "../modes/modeLine";
import { PARAMS, SEVERITY_RANK, comparedSides, findingStatus, limitingParam, num, overlapPct, priLabel } from "./ambiguityText";

/** One side's range for a parameter, as the check compared it (with deltas). */
export function sideRange(s: ComparedSide, p: OverlapParam): [number, number] | null {
  if (p === "rf") return s.rf;
  if (p === "pw") return s.pw;
  if (p === "jitter") return s.jitter ?? null;
  return s.pri ?? s.frame_time ?? null;
}

/** A Stagger's steps, when PRI was compared on identical steps. */
export function sideSteps(s: ComparedSide, p: OverlapParam): number[] | null {
  return p === "pri" && !sideRange(s, p) && s.stagger?.length ? s.stagger : null;
}

/** How much of range a lies inside range b, 0–1. A single value is in or out. */
export function shareInside(a: [number, number], b: [number, number]): number {
  const len = a[1] - a[0];
  if (len <= 0) return a[0] >= b[0] && a[0] <= b[1] ? 1 : 0;
  return Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0])) / len;
}

function stepsInside(a: number[], b: number[]): number {
  const bs = new Set(b.map((v) => Math.round(v * 1e6)));
  const own = new Set(a.map((v) => Math.round(v * 1e6)));
  if (own.size === 0) return 0;
  return [...own].filter((v) => bs.has(v)).length / own.size;
}

export interface ParamShares {
  param: OverlapParam;
  /** How much of A's range B covers, and the other way round, 0–1. */
  aInB: number;
  bInA: number;
}

/** The parameters the finding compared, in the usual order. */
export function comparedParams(f: AmbiguityFinding): OverlapParam[] {
  return PARAMS.map((p) => p.key).filter((k) => overlapPct(f, k) != null);
}

/** The overlap each way: per parameter, and for the whole box — how much of
 * A's box lies inside B's (the product over parameters) and the reverse. A
 * narrow Mode inside a wide one is 100% one way and small the other. */
export function directional(f: AmbiguityFinding): { aInB: number; bInA: number; params: ParamShares[] } {
  const { a, b } = comparedSides(f);
  const params: ParamShares[] = [];
  for (const p of comparedParams(f)) {
    const ra = sideRange(a, p);
    const rb = sideRange(b, p);
    if (ra && rb) {
      params.push({ param: p, aInB: shareInside(ra, rb), bInA: shareInside(rb, ra) });
      continue;
    }
    const sa = sideSteps(a, p);
    const sb = sideSteps(b, p);
    if (sa && sb) params.push({ param: p, aInB: stepsInside(sa, sb), bInA: stepsInside(sb, sa) });
  }
  return {
    aInB: params.reduce((x, s) => x * s.aInB, 1),
    bInA: params.reduce((x, s) => x * s.bInA, 1),
    params,
  };
}

/** One way to make a pair tell apart on one parameter: move one Mode's edge. */
export interface Separation {
  param: OverlapParam;
  side: "a" | "b";
  edge: "min" | "max";
  /** The edge now (with its delta) and where it must go: to `target` or past it. */
  from: number;
  target: number;
  /** How far the edge moves. */
  amount: number;
  /** amount as a share of the narrower range — what ranks the options. */
  relative: number;
}

export interface ParamSeparation {
  param: OverlapParam;
  label: string;
  unit: string;
  /** Edge moves that separate them, smallest first (at most two). */
  options: Separation[];
  /** Stagger steps both have, when PRI is compared on identical steps. */
  sharedSteps?: number[];
  /** Identical ranges: no single edge move leaves both with a range. */
  identical?: boolean;
  /** The smallest relative change on this parameter (Infinity when none). */
  best: number;
}

const UNIT: Record<OverlapParam, string> = { rf: "MHz", pw: "µs", pri: "µs", jitter: "µs" };

/** For each parameter, the smallest moves of one edge that would separate
 * the two Modes on it — parameters with the smallest change first. Ranges
 * are the compared ones (deltas included): touching ends don't overlap. */
export function separations(f: AmbiguityFinding): ParamSeparation[] {
  const { a, b } = comparedSides(f);
  const out: ParamSeparation[] = [];
  for (const p of comparedParams(f)) {
    const label = p === "pri" ? priLabel(f) : (PARAMS.find((x) => x.key === p)?.label ?? p);
    const ra = sideRange(a, p);
    const rb = sideRange(b, p);
    if (!ra || !rb) {
      const sa = sideSteps(a, p) ?? [];
      const sb = new Set((sideSteps(b, p) ?? []).map((v) => Math.round(v * 1e6)));
      const shared = [...new Set(sa.filter((v) => sb.has(Math.round(v * 1e6))))];
      out.push({ param: p, label, unit: UNIT[p], options: [], sharedSteps: shared, best: shared.length ? 1 : Infinity });
      continue;
    }
    const narrow = Math.min(ra[1] - ra[0], rb[1] - rb[0]) || Math.max(Math.abs(ra[1]), Math.abs(rb[1]), 1);
    const options: Separation[] = [];
    const add = (side: "a" | "b", edge: "min" | "max", from: number, target: number, keepsRange: boolean) => {
      if (!keepsRange) return;
      const amount = Math.abs(from - target);
      options.push({ param: p, side, edge, from, target, amount, relative: amount / narrow });
    };
    const [a0, a1] = ra;
    const [b0, b1] = rb;
    // A below B: A's max down to B's min, or B's min up to A's max.
    add("a", "max", a1, b0, a0 < b0);
    add("b", "min", b0, a1, b1 > a1);
    // A above B: B's max down to A's min, or A's min up to B's max.
    add("b", "max", b1, a0, b0 < a0);
    add("a", "min", a0, b1, a1 > b1);
    options.sort((x, y) => x.amount - y.amount);
    out.push({
      param: p,
      label,
      unit: UNIT[p],
      options: options.slice(0, 2),
      identical: options.length === 0,
      best: options[0]?.relative ?? Infinity,
    });
  }
  return out.sort((x, y) => x.best - y.best);
}

const TYPED_FIELD: Record<"rf" | "pw" | "pri", { min: keyof LineValues; max: keyof LineValues; delta: string }> = {
  rf: { min: "rfMin", max: "rfMax", delta: "rf_delta" },
  pw: { min: "pwMin", max: "pwMax", delta: "pw_delta" },
  pri: { min: "priMin", max: "priMax", delta: "pri_delta" },
};

/** The edit form's change that makes a separation: the typed value is the
 * target less the Mode's own ± delta (a max) or plus it (a min). Null when
 * the parameter isn't edited as a plain min/max (frame time, steps). */
export function separationChange(
  f: AmbiguityFinding,
  s: Separation,
  line: { [k: string]: unknown } | null | undefined,
): Partial<LineValues> | null {
  if (s.param === "pri" && f.details.pri_basis && f.details.pri_basis !== "range") return null;
  const round = (v: number) => String(Math.round(v * 1e6) / 1e6);
  if (s.param === "jitter") return { [s.edge === "min" ? "jitterMin" : "jitterMax"]: round(s.target) } as Partial<LineValues>;
  const fields = TYPED_FIELD[s.param];
  const margins = f.details.margins_applied !== false;
  const delta = margins ? Number(line?.[fields.delta] ?? 0) || 0 : 0;
  const typed = s.edge === "max" ? s.target - delta : s.target + delta;
  return { [s.edge === "max" ? fields.max : fields.min]: round(typed) } as Partial<LineValues>;
}

export function separationText(s: Separation, names: { a: string; b: string }, unit: string): string {
  const who = s.side === "a" ? names.a : names.b;
  const dir = s.edge === "max" ? "down to" : "up to";
  return `${who}'s ${s.edge} ${num(s.from)} ${dir} ${num(s.target)} ${unit} (moves ${num(round3(s.amount))})`;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** A finding in a sentence: what still tells the two apart, if anything. */
export function decidingText(f: AmbiguityFinding): string {
  const params = comparedParams(f);
  const partial = params.filter((p) => (overlapPct(f, p) ?? 0) < 99.95);
  const name = (p: OverlapParam) => (p === "pri" ? priLabel(f) : (PARAMS.find((x) => x.key === p)?.label ?? p));
  if (partial.length === 0) return "Overlap fully on every parameter";
  const lim = limitingParam(f);
  const rest = partial.filter((p) => p !== lim);
  const head = `${name(lim)} ${Math.round(overlapPct(f, lim) ?? 0)}%`;
  return rest.length === 0
    ? `Only ${head} — the rest overlap fully`
    : `${head}, ${rest.map((p) => `${name(p)} ${Math.round(overlapPct(f, p) ?? 0)}%`).join(", ")}`;
}

/* ---------- Groups ---------- */

export interface GroupMode {
  id: string;
  name: string;
  emitterId: string;
  emitterName: string;
  side: FindingModeSide;
  /** Its compared ranges (any finding's — they're the same in every one). */
  compared: ComparedSide;
  pairs: number;
  open: number;
  worst: AmbiguitySeverity;
}

export interface FindingGroup {
  key: string;
  /** Modes overlapping each other, joined through shared findings — or one
   * pair of Emitters. */
  kind: "modes" | "emitters";
  label: string;
  findings: AmbiguityFinding[];
  modes: GroupMode[];
  worst: AmbiguitySeverity;
  open: number;
  counts: Record<AmbiguitySeverity, number>;
  /** The parameter that sets the severity most often here. */
  deciding: OverlapParam;
  emitters: string[];
}

const blank = (): Record<AmbiguitySeverity, number> => ({ exact_overlap: 0, high: 0, medium: 0, low: 0, none: 0 });
const worse = (x: AmbiguitySeverity, y: AmbiguitySeverity) => (SEVERITY_RANK[x] <= SEVERITY_RANK[y] ? x : y);
const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function buildGroup(key: string, kind: FindingGroup["kind"], findings: AmbiguityFinding[], label?: string): FindingGroup {
  const modes = new Map<string, GroupMode>();
  const counts = blank();
  const deciding = new Map<OverlapParam, number>();
  let worst: AmbiguitySeverity = "none";
  let open = 0;
  for (const f of findings) {
    const { a, b } = comparedSides(f);
    const isOpen = findingStatus(f) === "open";
    counts[f.combined_severity] += 1;
    worst = worse(worst, f.combined_severity);
    if (isOpen) open += 1;
    const lim = limitingParam(f);
    deciding.set(lim, (deciding.get(lim) ?? 0) + 1);
    for (const [id, side, compared] of [
      [f.mode_id_a, f.details.mode_a, a],
      [f.mode_id_b, f.details.mode_b, b],
    ] as const) {
      const m =
        modes.get(id) ??
        ({
          id,
          name: side.mode_name,
          emitterId: side.emitter_id,
          emitterName: side.emitter_name,
          side,
          compared,
          pairs: 0,
          open: 0,
          worst: "none",
        } as GroupMode);
      m.pairs += 1;
      if (isOpen) m.open += 1;
      m.worst = worse(m.worst, f.combined_severity);
      modes.set(id, m);
    }
  }
  const sortedModes = [...modes.values()].sort(
    (x, y) => natural.compare(x.emitterName, y.emitterName) || natural.compare(x.name, y.name),
  );
  const emitters = [...new Set(sortedModes.map((m) => m.emitterName))];
  const top = [...deciding.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "rf";
  return {
    key,
    kind,
    label: label ?? modesLabel(sortedModes),
    findings,
    modes: sortedModes,
    worst,
    open,
    counts,
    deciding: top,
    emitters,
  };
}

function modesLabel(modes: GroupMode[]): string {
  const names = modes.map((m) => m.name);
  return names.length <= 4 ? names.join(", ") : `${names.slice(0, 3).join(", ")} … ${names[names.length - 1]}`;
}

/** Modes joined through shared findings: fixing a group is one piece of work. */
export function modeGroups(findings: AmbiguityFinding[]): FindingGroup[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) as string;
    parent.set(x, r);
    return r;
  };
  for (const f of findings) {
    for (const id of [f.mode_id_a, f.mode_id_b]) if (!parent.has(id)) parent.set(id, id);
    const ra = find(f.mode_id_a);
    const rb = find(f.mode_id_b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const byRoot = new Map<string, AmbiguityFinding[]>();
  for (const f of findings) {
    const r = find(f.mode_id_a);
    byRoot.set(r, [...(byRoot.get(r) ?? []), f]);
  }
  return sortGroups([...byRoot.entries()].map(([r, fs]) => buildGroup(`modes:${r}`, "modes", fs)));
}

/** One group per pair of Emitters — the Platform and MDF question. */
export function emitterPairGroups(findings: AmbiguityFinding[]): FindingGroup[] {
  const byKey = new Map<string, AmbiguityFinding[]>();
  const names = new Map<string, string>();
  for (const f of findings) {
    const { mode_a: a, mode_b: b } = f.details;
    const [x, y] = natural.compare(a.emitter_name, b.emitter_name) <= 0 ? [a, b] : [b, a];
    const key = `emitters:${x.emitter_id}|${y.emitter_id}`;
    names.set(key, x.emitter_id === y.emitter_id ? `Inside ${x.emitter_name}` : `${x.emitter_name} ↔ ${y.emitter_name}`);
    byKey.set(key, [...(byKey.get(key) ?? []), f]);
  }
  return sortGroups([...byKey.entries()].map(([k, fs]) => buildGroup(k, "emitters", fs, names.get(k))));
}

function sortGroups(groups: FindingGroup[]): FindingGroup[] {
  return groups.sort(
    (x, y) =>
      Number(y.open > 0) - Number(x.open > 0) ||
      SEVERITY_RANK[x.worst] - SEVERITY_RANK[y.worst] ||
      y.open - x.open ||
      y.findings.length - x.findings.length ||
      natural.compare(x.label, y.label),
  );
}

/* ---------- Changed since the check ---------- */

const LINE_KEYS = [
  "rf_min_mhz",
  "rf_max_mhz",
  "rf_delta",
  "pw_min_us",
  "pw_max_us",
  "pw_delta",
  "pri_min_us",
  "pri_max_us",
  "pri_delta",
  "jitter_min_us",
  "jitter_max_us",
  "pri_stagger_values_us",
  "frame_time_delta_us",
  "explicit_frame_time_us",
  "pri_range_matching",
] as const;

function same(x: unknown, y: unknown): boolean {
  if (Array.isArray(x) || Array.isArray(y)) return JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
  if (typeof x === "number" || typeof y === "number") return Number(x ?? NaN) === Number(y ?? NaN) || (x == null && y == null);
  return (x ?? null) === (y ?? null) || (!x && !y);
}

/** Whether a Mode's line now differs from what the check read (or it's gone).
 * Null when the live Modes aren't known. */
export function modeChange(
  side: FindingModeSide,
  live: { id: string; pri_type: string; line: { [k: string]: unknown } | null }[] | undefined,
  modeId: string,
): "changed" | "gone" | null {
  if (!live) return null;
  const m = live.find((x) => x.id === modeId);
  if (!m) return "gone";
  if (side.pri_type && m.pri_type !== side.pri_type) return "changed";
  const snap = side.line as unknown as Record<string, unknown>;
  const now = m.line ?? {};
  return LINE_KEYS.some((k) => k in snap && !same(snap[k], now[k])) ? "changed" : null;
}
