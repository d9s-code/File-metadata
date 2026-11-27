/** An operational mode's plan against the Emitter's Modes: which planned
 * values — and which combinations of them — no Mode under it covers. Pure,
 * so it can be tested on its own. A Mode covers a planned value when its
 * range, with its delta, holds the whole planned value. */
import type { PlannedCombination, PlannedValue } from "../../api/operationalModes";
import type { Mode } from "../../types/domain";
import type { TreeNode } from "./opTree";

export const PLAN_PARAMS = ["rf", "pri", "pw"] as const;
export type PlanParam = (typeof PLAN_PARAMS)[number];
export const PLAN_LABEL: Record<PlanParam, string> = { rf: "RF", pri: "PRI", pw: "PW" };
export const PLAN_UNIT: Record<PlanParam, string> = { rf: "MHz", pri: "µs", pw: "µs" };

export interface EffectivePlan {
  values: Partial<Record<PlanParam, PlannedValue[]>>;
  /** Where each parameter's values come from: the operational mode that plans them. */
  from: Partial<Record<PlanParam, string>>;
  dwellSwitch: boolean;
}

/** Its plan, a parameter it plans none of taken from the nearest one above it that does. */
export function effectivePlan(node: TreeNode, byId: Map<string, TreeNode>): EffectivePlan {
  const out: EffectivePlan = { values: {}, from: {}, dwellSwitch: false };
  let current: TreeNode | undefined = node;
  const seen = new Set<string>();
  while (current && !seen.has(current.op.id)) {
    seen.add(current.op.id);
    const plan = current.op.plan ?? {};
    for (const k of PLAN_PARAMS) {
      if (out.values[k] === undefined && plan[k]?.length) {
        out.values[k] = plan[k]!;
        out.from[k] = current.op.name;
        if (k === "pri") out.dwellSwitch = !!plan.pri_dwell_switch;
      }
    }
    current = current.op.parent_id ? byId.get(current.op.parent_id) : undefined;
  }
  return out;
}

const hi = (v: PlannedValue) => v.max ?? v.min;

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

const EPS = 1e-9;

/** The Mode covers this planned value of the parameter. A stagger covers a PRI one of its steps falls in. */
export function covers(m: Mode, p: PlanParam, v: PlannedValue): boolean {
  if (p === "pri" && m.pri_type === "stagger") {
    return (m.line?.pri_stagger_values_us ?? []).some((s) => s >= v.min - EPS && s <= hi(v) + EPS);
  }
  const r = modeRange(m, p);
  return !!r && r[0] <= v.min + EPS && hi(v) <= r[1] + EPS;
}

export type Combination = Partial<Record<PlanParam, PlannedValue>>;

/** Every combination of its planned values (a parameter not planned anywhere isn't in them). */
export function combinations(plan: EffectivePlan): Combination[] {
  let out: Combination[] = [{}];
  for (const k of PLAN_PARAMS) {
    const values = plan.values[k];
    if (!values?.length) continue;
    out = out.flatMap((c) => values.map((v) => ({ ...c, [k]: v })));
  }
  return out.length === 1 && !Object.keys(out[0]).length ? [] : out;
}

export const coveredBy = (modes: Mode[], c: Combination) =>
  modes.find((m) => (Object.keys(c) as PlanParam[]).every((k) => covers(m, k, c[k]!)));

export interface PlanCoverage {
  plan: EffectivePlan;
  /** Each planned value, whether some Mode under it covers it. */
  valueCovered: Partial<Record<PlanParam, boolean[]>>;
  combos: { combo: Combination; mode: Mode | undefined }[];
  uncovered: number;
}

/** Coverage of an operational mode that plans something itself, by the Modes under it. */
export function planCoverage(node: TreeNode, byId: Map<string, TreeNode>): PlanCoverage | null {
  const own = node.op.plan;
  if (!own || !PLAN_PARAMS.some((k) => own[k]?.length)) return null;
  const plan = effectivePlan(node, byId);
  const modes = node.allModes;
  const valueCovered: PlanCoverage["valueCovered"] = {};
  for (const k of PLAN_PARAMS) {
    const values = plan.values[k];
    if (values) valueCovered[k] = values.map((v) => modes.some((m) => covers(m, k, v)));
  }
  const combos = combinations(plan).map((combo) => ({ combo, mode: coveredBy(modes, combo) }));
  return { plan, valueCovered, combos, uncovered: combos.filter((c) => !c.mode).length };
}

const n = (v: number) => String(Number(v.toFixed(4)));

/** "9400–9450 MHz", "100 µs × 64 pulses". */
export function valueText(v: PlannedValue, p: PlanParam): string {
  const range = v.max == null || v.max === v.min ? n(v.min) : `${n(v.min)}–${n(v.max)}`;
  const dwell = v.dwell_pulses ? ` × ${v.dwell_pulses} pulses` : v.dwell_ms ? ` × ${n(v.dwell_ms)} ms` : "";
  return `${range} ${PLAN_UNIT[p]}${dwell}`;
}

export function comboText(c: Combination): string {
  return PLAN_PARAMS.filter((k) => c[k])
    .map((k) => `${PLAN_LABEL[k]} ${valueText({ ...c[k]!, dwell_pulses: null, dwell_ms: null }, k)}`)
    .join(" · ");
}

/** A combination as a Mode to make — every one of RF, PRI and PW needed; null when one isn't planned. */
export function asModeCombination(c: Combination): PlannedCombination | null {
  if (!c.rf || !c.pri || !c.pw) return null;
  return {
    rf_min_mhz: c.rf.min,
    rf_max_mhz: hi(c.rf),
    pri_min_us: c.pri.min,
    pri_max_us: hi(c.pri),
    pw_min_us: c.pw.min,
    pw_max_us: hi(c.pw),
  };
}
