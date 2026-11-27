import type { OperationalModePlan, PlannedValue } from "../../api/operationalModes";
import { PLAN_LABEL, PLAN_PARAMS, PLAN_UNIT, valueText, type EffectivePlan, type PlanParam } from "./planCoverage";

/** A planned value as typed. */
export interface PlanRow {
  min: string;
  max: string;
  note: string;
  dwell: string;
  dwellUnit: "pulses" | "ms";
}
export interface PlanDraft {
  rf: PlanRow[];
  pri: PlanRow[];
  pw: PlanRow[];
  dwellSwitch: boolean;
}

const blankRow = (): PlanRow => ({ min: "", max: "", note: "", dwell: "", dwellUnit: "pulses" });

export function draftFrom(plan: OperationalModePlan | null | undefined): PlanDraft {
  const rows = (vs: PlannedValue[] | undefined): PlanRow[] =>
    (vs ?? []).map((v) => ({
      min: String(v.min),
      max: v.max != null && v.max !== v.min ? String(v.max) : "",
      note: v.note ?? "",
      dwell: v.dwell_pulses != null ? String(v.dwell_pulses) : v.dwell_ms != null ? String(v.dwell_ms) : "",
      dwellUnit: v.dwell_ms != null ? "ms" : "pulses",
    }));
  return { rf: rows(plan?.rf), pri: rows(plan?.pri), pw: rows(plan?.pw), dwellSwitch: !!plan?.pri_dwell_switch };
}

/** What's wrong with the plan as typed, if anything. */
export function draftProblem(d: PlanDraft): string | null {
  for (const k of PLAN_PARAMS) {
    for (const [i, r] of d[k].entries()) {
      const where = `${PLAN_LABEL[k]} value ${i + 1}`;
      const lo = Number(r.min);
      if (!r.min.trim() || !(lo > 0)) return `${where}: a number above 0`;
      if (r.max.trim() && !(Number(r.max) >= lo)) return `${where}: its max must be a number, not below its min`;
      if (k === "pri" && d.dwellSwitch && r.dwell.trim()) {
        const dw = Number(r.dwell);
        if (!(dw > 0) || (r.dwellUnit === "pulses" && !Number.isInteger(dw))) return `${where}: its dwell is ${r.dwellUnit === "pulses" ? "a whole number of pulses" : "a time above 0 ms"}`;
      }
    }
  }
  if (d.dwellSwitch && d.pri.length < 2) return "A dwell & switch PRI needs 2 PRIs or more";
  return null;
}

/** The plan as the API takes it (null: nothing planned). Only when draftProblem is null. */
export function draftPlan(d: PlanDraft): OperationalModePlan | null {
  const values = (k: PlanParam): PlannedValue[] =>
    d[k].map((r) => {
      const v: PlannedValue = { min: Number(r.min) };
      if (r.max.trim() && Number(r.max) !== v.min) v.max = Number(r.max);
      if (r.note.trim()) v.note = r.note.trim();
      if (k === "pri" && d.dwellSwitch && r.dwell.trim()) {
        if (r.dwellUnit === "pulses") v.dwell_pulses = Number(r.dwell);
        else v.dwell_ms = Number(r.dwell);
      }
      return v;
    });
  const plan: OperationalModePlan = { rf: values("rf"), pri: values("pri"), pw: values("pw"), pri_dwell_switch: d.dwellSwitch };
  return plan.rf!.length || plan.pri!.length || plan.pw!.length ? plan : null;
}

/** An operational mode's plan: several RF, PRI and PW values, each with a
 * note; a PRI marked dwell & switch, each PRI with its dwell. A parameter
 * left empty takes the one above it's. */
export function PlanEditor({ draft, onChange, inherited }: { draft: PlanDraft; onChange: (d: PlanDraft) => void; inherited: EffectivePlan | null }) {
  const setRow = (k: PlanParam, i: number, part: Partial<PlanRow>) =>
    onChange({ ...draft, [k]: draft[k].map((r, j) => (j === i ? { ...r, ...part } : r)) });
  return (
    <fieldset className="plan-editor">
      <legend>Plan — for analysis; the Modes aren&apos;t changed</legend>
      {PLAN_PARAMS.map((k) => {
        const from = inherited?.from[k];
        const dwellSwitch = k === "pri" && draft.dwellSwitch;
        return (
          <div key={k} className="plan-param">
            <div className="plan-param-head">
              <strong>
                {PLAN_LABEL[k]} ({PLAN_UNIT[k]})
              </strong>
              {k === "pri" && (
                <label className="inline-check">
                  <input type="checkbox" checked={draft.dwellSwitch} onChange={(e) => onChange({ ...draft, dwellSwitch: e.target.checked })} />
                  Dwell &amp; switch
                </label>
              )}
              {!draft[k].length && (
                <span className="hint-text">
                  {from && inherited?.values[k]
                    ? `From ${from}: ${inherited.values[k]!.map((v) => valueText(v, k)).join(" / ")}`
                    : "None planned"}
                </span>
              )}
            </div>
            {draft[k].map((r, i) => (
              <div key={i} className={dwellSwitch ? "plan-row dwell" : "plan-row"}>
                <input
                  type="number"
                  step="any"
                  min="0"
                  aria-label={`${PLAN_LABEL[k]} ${i + 1} min`}
                  placeholder="min"
                  value={r.min}
                  onChange={(e) => setRow(k, i, { min: e.target.value })}
                />
                <input
                  type="number"
                  step="any"
                  min="0"
                  aria-label={`${PLAN_LABEL[k]} ${i + 1} max`}
                  placeholder="max (= min)"
                  value={r.max}
                  onChange={(e) => setRow(k, i, { max: e.target.value })}
                />
                {dwellSwitch && (
                  <span className="plan-dwell">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      aria-label={`${PLAN_LABEL[k]} ${i + 1} dwell`}
                      placeholder="dwell"
                      value={r.dwell}
                      onChange={(e) => setRow(k, i, { dwell: e.target.value })}
                    />
                    <select
                      aria-label={`${PLAN_LABEL[k]} ${i + 1} dwell unit`}
                      value={r.dwellUnit}
                      onChange={(e) => setRow(k, i, { dwellUnit: e.target.value as PlanRow["dwellUnit"] })}
                    >
                      <option value="pulses">pulses</option>
                      <option value="ms">ms</option>
                    </select>
                  </span>
                )}
                <input
                  className="plan-note"
                  aria-label={`${PLAN_LABEL[k]} ${i + 1} note`}
                  placeholder="Note — why, where from…"
                  value={r.note}
                  onChange={(e) => setRow(k, i, { note: e.target.value })}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${PLAN_LABEL[k]} ${i + 1}`}
                  onClick={() => onChange({ ...draft, [k]: draft[k].filter((_, j) => j !== i) })}
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="link-button" onClick={() => onChange({ ...draft, [k]: [...draft[k], blankRow()] })}>
              + {PLAN_LABEL[k]} value
            </button>
          </div>
        );
      })}
    </fieldset>
  );
}
