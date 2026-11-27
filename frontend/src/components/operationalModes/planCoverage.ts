/** An operational mode's plan against the Emitter's Modes: which planned
 * values — and which combinations of them — no Mode under it covers. Pure,
 * so it can be tested on its own. A Mode covers a planned value when its
 * range, with its delta, holds the whole planned value; a planned stagger
 * when its steps match in order (each within the step tolerance) — or, with
 * the Mode's PRI range matching on, starting from any step. */
import type { PlannedCombination, PlannedStagger, PlannedValue } from "../../api/operationalModes";
import type { Mode } from "../../types/domain";
import type { TreeNode } from "./opTree";

export const PLAN_PARAMS = ["rf", "pri", "pw"] as const;
export type PlanParam = (typeof PLAN_PARAMS)[number];
export const PLAN_LABEL: Record<PlanParam, string> = { rf: "RF", pri: "PRI", pw: "PW" };
export const PLAN_UNIT: Record<PlanParam, string> = { rf: "MHz", pri: "µs", pw: "µs" };

export interface EffectivePlan {
  values: Partial<Record<PlanParam, PlannedValue[]>>;
  /** The PRI as staggers, instead of values. */
  staggers: PlannedStagger[];
  /** Where each parameter comes from: the operational mode that plans it. */
  from: Partial<Record<PlanParam, string>>;
  dwellSwitch: boolean;
  /** PW goes with each PRI (or stagger step). */
  paired: boolean;
}

const plansPri = (p: { pri?: PlannedValue[]; pri_stagger?: PlannedStagger[] } | null | undefined) =>
  !!(p?.pri?.length || p?.pri_stagger?.length);

/** Its plan, a parameter it plans none of taken from the nearest one above
 * it that does. PW paired with PRI comes with that PRI. */
export function effectivePlan(node: TreeNode, byId: Map<string, TreeNode>): EffectivePlan {
  const out: EffectivePlan = { values: {}, staggers: [], from: {}, dwellSwitch: false, paired: false };
  let current: TreeNode | undefined = node;
  const seen = new Set<string>();
  while (current && !seen.has(current.op.id)) {
    seen.add(current.op.id);
    const plan = current.op.plan ?? {};
    if (out.from.rf === undefined && plan.rf?.length) {
      out.values.rf = plan.rf;
      out.from.rf = current.op.name;
    }
    if (out.from.pri === undefined && plansPri(plan)) {
      out.values.pri = plan.pri?.length ? plan.pri : undefined;
      out.staggers = plan.pri_stagger ?? [];
      out.from.pri = current.op.name;
      out.dwellSwitch = !!plan.pri_dwell_switch;
      out.paired = !!plan.pri_pw_paired;
      if (out.paired) out.from.pw = current.op.name;
    }
    if (out.from.pw === undefined && plan.pw?.length) {
      out.values.pw = plan.pw;
      out.from.pw = current.op.name;
    }
    current = current.op.parent_id ? byId.get(current.op.parent_id) : undefined;
  }
  return out;
}

const hi = (v: PlannedValue) => v.max ?? v.min;
const EPS = 1e-9;

/** The Mode's range for a parameter, with its delta; null: it has none (a CW's PRI). */
function modeRange(m: Mode, p: PlanParam): [number, number] | null {
  const l = m.line;
  if (!l) return null;
  const widen = (a: number | null | undefined, b: number | null | undefined, d: number | null | undefined) =>
    a == null || b == null ? null : ([a - (d ?? 0), b + (d ?? 0)] as [number, number]);
  if (p === "rf") return widen(l.rf_min_mhz, l.rf_max_mhz, l.rf_delta);
  if (p === "pw") return widen(l.pw_min_us, l.pw_max_us, l.pw_delta);
  if (m.pri_type === "fixed") return widen(l.pri_min_us, l.pri_max_us, l.pri_delta);
  return null;
}

/** The Mode covers this planned value of the parameter. A stagger covers a PRI one of its steps falls in. */
export function covers(m: Mode, p: PlanParam, v: PlannedValue): boolean {
  if (p === "pri" && m.pri_type === "stagger") {
    return (m.line?.pri_stagger_values_us ?? []).some((s) => s >= v.min - EPS && s <= hi(v) + EPS);
  }
  const r = modeRange(m, p);
  return !!r && r[0] <= v.min + EPS && hi(v) <= r[1] + EPS;
}

/** A stagger Mode covers a planned stagger: the same steps in order, each
 * within `tol` µs — or, with its PRI range matching on, starting from any step. */
export function coversStagger(m: Mode, st: PlannedStagger, tol: number): boolean {
  if (m.pri_type !== "stagger") return false;
  const steps = m.line?.pri_stagger_values_us ?? [];
  const n = st.steps.length;
  if (steps.length !== n) return false;
  const starts = m.line?.pri_range_matching ? n : 1;
  for (let k = 0; k < starts; k++) {
    if (st.steps.every((s, i) => Math.abs(steps[(i + k) % n] - s) <= tol + EPS)) return true;
  }
  return false;
}

/** One combination: an RF, a PRI (a value or a stagger) and a PW. */
export interface Combination {
  rf?: PlannedValue;
  pri?: PlannedValue;
  stagger?: PlannedStagger;
  pw?: PlannedValue;
}

/** The PW a paired PRI value or stagger carries (a stagger's: its lowest to highest step PW). */
export function pairedPw(item: PlannedValue | PlannedStagger): PlannedValue | undefined {
  if ("steps" in item) {
    const pws = item.pw_steps ?? [];
    return pws.length ? { min: Math.min(...pws), max: Math.max(...pws) } : undefined;
  }
  return item.pw_min != null ? { min: item.pw_min, max: item.pw_max ?? item.pw_min } : undefined;
}

/** Every combination of its planned values: RF × PRI × PW — or, PW paired, RF × (PRI with its PW). */
export function combinations(plan: EffectivePlan): Combination[] {
  const pris: Combination[] = [
    ...(plan.values.pri ?? []).map((v) => ({ pri: v, ...(plan.paired ? { pw: pairedPw(v) } : {}) })),
    ...plan.staggers.map((st) => ({ stagger: st, ...(plan.paired ? { pw: pairedPw(st) } : {}) })),
  ];
  let out: Combination[] = [{}];
  if (plan.values.rf?.length) out = out.flatMap((c) => plan.values.rf!.map((v) => ({ ...c, rf: v })));
  if (pris.length) out = out.flatMap((c) => pris.map((p) => ({ ...c, ...p })));
  if (!plan.paired && plan.values.pw?.length) out = out.flatMap((c) => plan.values.pw!.map((v) => ({ ...c, pw: v })));
  return out.length === 1 && !Object.keys(out[0]).length ? [] : out;
}

/** The Mode covers every part of the combination. */
export function coversAll(m: Mode, c: Combination, tol: number): boolean {
  return (
    (!c.rf || covers(m, "rf", c.rf)) &&
    (!c.pri || covers(m, "pri", c.pri)) &&
    (!c.stagger || coversStagger(m, c.stagger, tol)) &&
    (!c.pw || covers(m, "pw", c.pw))
  );
}

export const coveredBy = (modes: Mode[], c: Combination, tol: number) => modes.find((m) => coversAll(m, c, tol));

/** One planned thing as shown: a chip, covered or not. */
export interface PlanChip {
  key: string;
  label: string;
  text: string;
  note?: string | null;
  covered: boolean;
}

export interface PlanCoverage {
  plan: EffectivePlan;
  /** Its own planned values, each with whether a Mode under it covers it. */
  chips: PlanChip[];
  combos: { combo: Combination; mode: Mode | undefined }[];
  uncovered: number;
}

const n = (v: number) => String(Number(v.toFixed(4)));
const rangeText = (lo: number, h: number) => (h === lo ? n(lo) : `${n(lo)}–${n(h)}`);

/** "9400–9450 MHz", "100 µs × 64 pulses", "100 µs ↔ PW 1 µs". */
export function valueText(v: PlannedValue, p: PlanParam): string {
  const dwell = v.dwell_pulses ? ` × ${v.dwell_pulses} pulses` : v.dwell_ms ? ` × ${n(v.dwell_ms)} ms` : "";
  const pw = v.pw_min != null ? ` ↔ PW ${rangeText(v.pw_min, v.pw_max ?? v.pw_min)} µs` : "";
  return `${rangeText(v.min, hi(v))} ${PLAN_UNIT[p]}${dwell}${pw}`;
}

/** "300/400/500 µs", with "↔ PW 1/2/1 µs" when paired. */
export function staggerText(st: PlannedStagger): string {
  return `${st.steps.map(n).join("/")} µs${st.pw_steps?.length ? ` ↔ PW ${st.pw_steps.map(n).join("/")} µs` : ""}`;
}

/** Coverage of an operational mode that plans something itself, by the Modes under it. */
export function planCoverage(node: TreeNode, byId: Map<string, TreeNode>, tol: number): PlanCoverage | null {
  const own = node.op.plan;
  if (!own || !(own.rf?.length || plansPri(own) || own.pw?.length)) return null;
  const plan = effectivePlan(node, byId);
  const modes = node.allModes;
  const chips: PlanChip[] = [];
  (own.rf ?? []).forEach((v, i) =>
    chips.push({ key: `rf${i}`, label: "RF", text: valueText(v, "rf"), note: v.note, covered: modes.some((m) => covers(m, "rf", v)) }),
  );
  (own.pri ?? []).forEach((v, i) => {
    const pw = own.pri_pw_paired ? pairedPw(v) : undefined;
    chips.push({
      key: `pri${i}`,
      label: own.pri_dwell_switch ? "PRI D&S" : "PRI",
      text: valueText(v, "pri"),
      note: v.note,
      covered: modes.some((m) => covers(m, "pri", v) && (!pw || covers(m, "pw", pw))),
    });
  });
  (own.pri_stagger ?? []).forEach((st, i) => {
    const pw = own.pri_pw_paired ? pairedPw(st) : undefined;
    chips.push({
      key: `st${i}`,
      label: "PRI stagger",
      text: staggerText(st),
      note: st.note,
      covered: modes.some((m) => coversStagger(m, st, tol) && (!pw || covers(m, "pw", pw))),
    });
  });
  (own.pw ?? []).forEach((v, i) =>
    chips.push({ key: `pw${i}`, label: "PW", text: valueText(v, "pw"), note: v.note, covered: modes.some((m) => covers(m, "pw", v)) }),
  );
  const combos = combinations(plan).map((combo) => ({ combo, mode: coveredBy(modes, combo, tol) }));
  return { plan, chips, combos, uncovered: combos.filter((c) => !c.mode).length };
}

export function comboText(c: Combination): string {
  const parts: string[] = [];
  if (c.rf) parts.push(`RF ${rangeText(c.rf.min, hi(c.rf))} MHz`);
  if (c.pri) parts.push(`PRI ${rangeText(c.pri.min, hi(c.pri))} µs`);
  if (c.stagger) parts.push(`PRI stagger ${c.stagger.steps.map(n).join("/")} µs`);
  if (c.pw) parts.push(`PW ${rangeText(c.pw.min, hi(c.pw))} µs`);
  return parts.join(" · ");
}

/** A combination as a Mode to make — RF, a PRI (a range or a stagger) and PW all needed; null when one isn't planned. */
export function asModeCombination(c: Combination): PlannedCombination | null {
  if (!c.rf || !c.pw || !(c.pri || c.stagger)) return null;
  return {
    rf_min_mhz: c.rf.min,
    rf_max_mhz: hi(c.rf),
    ...(c.stagger
      ? { pri_stagger_values_us: c.stagger.steps, frame_time_delta_us: c.stagger.frame_time_delta_us ?? null }
      : { pri_min_us: c.pri!.min, pri_max_us: hi(c.pri!) }),
    pw_min_us: c.pw.min,
    pw_max_us: hi(c.pw),
  };
}
