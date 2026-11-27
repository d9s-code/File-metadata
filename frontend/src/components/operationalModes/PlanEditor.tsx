import type { OperationalModePlan, PlannedStagger, PlannedValue } from "../../api/operationalModes";
import { PLAN_LABEL, PLAN_PARAMS, PLAN_UNIT, staggerText, valueText, type EffectivePlan, type PlanParam } from "./planCoverage";

/** A planned value as typed. */
export interface PlanRow {
  min: string;
  max: string;
  note: string;
  dwell: string;
  dwellUnit: "pulses" | "ms";
  /** Its PW, when PW is paired with PRI. */
  pwMin: string;
  pwMax: string;
}
/** A planned stagger as typed. */
export interface StaggerRow {
  steps: string;
  frameDelta: string;
  note: string;
  /** A PW for each step, when PW is paired with PRI. */
  pwSteps: string;
}
export type PriKind = "values" | "dwell" | "stagger";
export interface PlanDraft {
  rf: PlanRow[];
  pri: PlanRow[];
  pw: PlanRow[];
  priKind: PriKind;
  staggers: StaggerRow[];
  /** PW goes with each PRI (or stagger step), pulse to pulse. */
  paired: boolean;
}

const blankRow = (): PlanRow => ({ min: "", max: "", note: "", dwell: "", dwellUnit: "pulses", pwMin: "", pwMax: "" });
const blankStagger = (): StaggerRow => ({ steps: "", frameDelta: "", note: "", pwSteps: "" });
const str = (v: number | null | undefined) => (v == null ? "" : String(v));
/** "300/400/500" or "300, 400 500" → numbers (NaN where a part isn't one). */
export const parseSteps = (text: string) => text.split(/[\s,/;]+/).filter(Boolean).map(Number);

export function draftFrom(plan: OperationalModePlan | null | undefined): PlanDraft {
  const rows = (vs: PlannedValue[] | undefined): PlanRow[] =>
    (vs ?? []).map((v) => ({
      min: String(v.min),
      max: v.max != null && v.max !== v.min ? String(v.max) : "",
      note: v.note ?? "",
      dwell: v.dwell_pulses != null ? String(v.dwell_pulses) : str(v.dwell_ms),
      dwellUnit: v.dwell_ms != null ? "ms" : "pulses",
      pwMin: str(v.pw_min),
      pwMax: v.pw_max != null && v.pw_max !== v.pw_min ? String(v.pw_max) : "",
    }));
  const staggers = (plan?.pri_stagger ?? []).map((st: PlannedStagger) => ({
    steps: st.steps.join("/"),
    frameDelta: str(st.frame_time_delta_us),
    note: st.note ?? "",
    pwSteps: (st.pw_steps ?? []).join("/"),
  }));
  return {
    rf: rows(plan?.rf),
    pri: rows(plan?.pri),
    pw: rows(plan?.pw),
    priKind: staggers.length ? "stagger" : plan?.pri_dwell_switch ? "dwell" : "values",
    staggers,
    paired: !!plan?.pri_pw_paired,
  };
}

/** What's wrong with the plan as typed, if anything. */
export function draftProblem(d: PlanDraft): string | null {
  const params: PlanParam[] = d.priKind === "stagger" ? ["rf", ...(d.paired ? [] : ["pw" as const])] : ["rf", "pri", ...(d.paired ? [] : ["pw" as const])];
  for (const k of params) {
    for (const [i, r] of d[k].entries()) {
      const where = `${PLAN_LABEL[k]} value ${i + 1}`;
      const lo = Number(r.min);
      if (!r.min.trim() || !(lo > 0)) return `${where}: a number above 0`;
      if (r.max.trim() && !(Number(r.max) >= lo)) return `${where}: its max must be a number, not below its min`;
      if (k === "pri" && d.priKind === "dwell" && r.dwell.trim()) {
        const dw = Number(r.dwell);
        if (!(dw > 0) || (r.dwellUnit === "pulses" && !Number.isInteger(dw)))
          return `${where}: its dwell is ${r.dwellUnit === "pulses" ? "a whole number of pulses" : "a time above 0 ms"}`;
      }
      if (k === "pri" && d.paired) {
        if (!(Number(r.pwMin) > 0)) return `${where}: give its PW (paired with PRI)`;
        if (r.pwMax.trim() && !(Number(r.pwMax) >= Number(r.pwMin))) return `${where}: its PW max can't be below its PW min`;
      }
    }
  }
  if (d.priKind === "dwell" && d.pri.length < 2) return "A dwell & switch PRI needs 2 PRIs or more";
  if (d.priKind === "stagger") {
    for (const [i, st] of d.staggers.entries()) {
      const steps = parseSteps(st.steps);
      if (steps.length < 2 || steps.some((x) => !(x > 0))) return `Stagger ${i + 1}: two steps or more, each above 0 µs`;
      if (st.frameDelta.trim() && !(Number(st.frameDelta) >= 0)) return `Stagger ${i + 1}: the frame-time delta is 0 or more`;
      if (d.paired) {
        const pws = parseSteps(st.pwSteps);
        if (pws.length !== steps.length || pws.some((x) => !(x > 0))) return `Stagger ${i + 1}: a PW above 0 for each of its ${steps.length} steps`;
      }
    }
  }
  if (d.paired && !(d.priKind === "stagger" ? d.staggers.length : d.pri.length)) return "Pairing PW with PRI needs a PRI planned";
  return null;
}

/** The plan as the API takes it (null: nothing planned). Only when draftProblem is null. */
export function draftPlan(d: PlanDraft): OperationalModePlan | null {
  const values = (k: PlanParam): PlannedValue[] =>
    d[k].map((r) => {
      const v: PlannedValue = { min: Number(r.min) };
      if (r.max.trim() && Number(r.max) !== v.min) v.max = Number(r.max);
      if (r.note.trim()) v.note = r.note.trim();
      if (k === "pri" && d.priKind === "dwell" && r.dwell.trim()) {
        if (r.dwellUnit === "pulses") v.dwell_pulses = Number(r.dwell);
        else v.dwell_ms = Number(r.dwell);
      }
      if (k === "pri" && d.paired) {
        v.pw_min = Number(r.pwMin);
        if (r.pwMax.trim() && Number(r.pwMax) !== v.pw_min) v.pw_max = Number(r.pwMax);
      }
      return v;
    });
  const stagger = d.priKind === "stagger";
  const plan: OperationalModePlan = {
    rf: values("rf"),
    pri: stagger ? [] : values("pri"),
    pri_dwell_switch: d.priKind === "dwell",
    pri_stagger: stagger
      ? d.staggers.map((st) => ({
          steps: parseSteps(st.steps),
          ...(st.frameDelta.trim() ? { frame_time_delta_us: Number(st.frameDelta) } : {}),
          ...(st.note.trim() ? { note: st.note.trim() } : {}),
          ...(d.paired ? { pw_steps: parseSteps(st.pwSteps) } : {}),
        }))
      : [],
    pri_pw_paired: d.paired,
    pw: d.paired ? [] : values("pw"),
  };
  return plan.rf!.length || plan.pri!.length || plan.pri_stagger!.length || plan.pw!.length ? plan : null;
}

/** An operational mode's plan: several RF, PRI and PW values, each with a
 * note. The PRI as values, a dwell & switch (each PRI with its dwell), or
 * staggers; PW paired with PRI pulse to pulse, each PRI (or stagger step)
 * carrying its own. A parameter left empty takes the one above it's. */
export function PlanEditor({ draft, onChange, inherited }: { draft: PlanDraft; onChange: (d: PlanDraft) => void; inherited: EffectivePlan | null }) {
  const setRow = (k: PlanParam, i: number, part: Partial<PlanRow>) =>
    onChange({ ...draft, [k]: draft[k].map((r, j) => (j === i ? { ...r, ...part } : r)) });
  const setStagger = (i: number, part: Partial<StaggerRow>) =>
    onChange({ ...draft, staggers: draft.staggers.map((r, j) => (j === i ? { ...r, ...part } : r)) });

  const inheritedText = (k: PlanParam): string | null => {
    const from = inherited?.from[k];
    if (!from || !inherited) return null;
    if (k === "pri" && inherited.staggers.length) return `From ${from}: stagger ${inherited.staggers.map(staggerText).join(" | ")}`;
    if (k === "pw" && inherited.paired) return `From ${from}: with each PRI`;
    const vs = inherited.values[k];
    return vs?.length ? `From ${from}: ${vs.map((v) => valueText(v, k)).join(" / ")}` : null;
  };

  const numberInput = (label: string, value: string, onValue: (v: string) => void, placeholder: string) => (
    <input type="number" step="any" min="0" aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onValue(e.target.value)} />
  );

  return (
    <fieldset className="plan-editor">
      <legend>Plan — for analysis; the Modes aren&apos;t changed</legend>
      {PLAN_PARAMS.map((k) => {
        const isPri = k === "pri";
        const isPw = k === "pw";
        const staggerMode = isPri && draft.priKind === "stagger";
        const rows = draft[k];
        const empty = staggerMode ? !draft.staggers.length : !rows.length;
        return (
          <div key={k} className="plan-param">
            <div className="plan-param-head">
              <strong>
                {PLAN_LABEL[k]} ({PLAN_UNIT[k]})
              </strong>
              {isPri && (
                <>
                  <label className="plan-kind">
                    as
                    <select aria-label="PRI as" value={draft.priKind} onChange={(e) => onChange({ ...draft, priKind: e.target.value as PriKind })}>
                      <option value="values">values</option>
                      <option value="dwell">dwell &amp; switch</option>
                      <option value="stagger">staggers</option>
                    </select>
                  </label>
                  <label className="inline-check" title="When the data suggests PRI and PW change together, pulse to pulse">
                    <input type="checkbox" checked={draft.paired} onChange={(e) => onChange({ ...draft, paired: e.target.checked })} />
                    PW goes with each PRI (pulse to pulse)
                  </label>
                </>
              )}
              {isPw && draft.paired ? (
                <span className="hint-text">Paired with PRI — each PRI {draft.priKind === "stagger" ? "step " : ""}carries its PW above.</span>
              ) : (
                empty && <span className="hint-text">{inheritedText(k) ?? "None planned"}</span>
              )}
            </div>
            {!(isPw && draft.paired) &&
              !staggerMode &&
              rows.map((r, i) => (
                <div key={i} className={`plan-row${isPri && draft.priKind === "dwell" ? " dwell" : ""}${isPri && draft.paired ? " paired" : ""}`}>
                  {numberInput(`${PLAN_LABEL[k]} ${i + 1} min`, r.min, (v) => setRow(k, i, { min: v }), "min")}
                  {numberInput(`${PLAN_LABEL[k]} ${i + 1} max`, r.max, (v) => setRow(k, i, { max: v }), "max (= min)")}
                  {isPri && draft.priKind === "dwell" && (
                    <span className="plan-dwell">
                      {numberInput(`${PLAN_LABEL[k]} ${i + 1} dwell`, r.dwell, (v) => setRow(k, i, { dwell: v }), "dwell")}
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
                  {isPri && draft.paired && (
                    <span className="plan-dwell" title="This PRI's PW, µs">
                      {numberInput(`PRI ${i + 1} PW min`, r.pwMin, (v) => setRow(k, i, { pwMin: v }), "PW")}
                      {numberInput(`PRI ${i + 1} PW max`, r.pwMax, (v) => setRow(k, i, { pwMax: v }), "PW max")}
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
                    onClick={() => onChange({ ...draft, [k]: rows.filter((_, j) => j !== i) })}
                  >
                    ×
                  </button>
                </div>
              ))}
            {staggerMode &&
              draft.staggers.map((st, i) => (
                <div key={i} className={`plan-row stagger${draft.paired ? " paired" : ""}`}>
                  <input
                    aria-label={`Stagger ${i + 1} steps`}
                    placeholder="steps, e.g. 300/400/500"
                    value={st.steps}
                    onChange={(e) => setStagger(i, { steps: e.target.value })}
                  />
                  {numberInput(`Stagger ${i + 1} frame delta`, st.frameDelta, (v) => setStagger(i, { frameDelta: v }), "frame ±")}
                  {draft.paired && (
                    <input
                      aria-label={`Stagger ${i + 1} PW per step`}
                      placeholder="PW per step, e.g. 1/2/1"
                      value={st.pwSteps}
                      onChange={(e) => setStagger(i, { pwSteps: e.target.value })}
                    />
                  )}
                  <input
                    className="plan-note"
                    aria-label={`Stagger ${i + 1} note`}
                    placeholder="Note — why, where from…"
                    value={st.note}
                    onChange={(e) => setStagger(i, { note: e.target.value })}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove stagger ${i + 1}`}
                    onClick={() => onChange({ ...draft, staggers: draft.staggers.filter((_, j) => j !== i) })}
                  >
                    ×
                  </button>
                </div>
              ))}
            {!(isPw && draft.paired) && (
              <button
                type="button"
                className="link-button"
                onClick={() =>
                  staggerMode ? onChange({ ...draft, staggers: [...draft.staggers, blankStagger()] }) : onChange({ ...draft, [k]: [...rows, blankRow()] })
                }
              >
                + {staggerMode ? "stagger" : `${PLAN_LABEL[k]} value`}
              </button>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
