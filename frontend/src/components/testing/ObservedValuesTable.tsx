import { useState } from "react";
import type { ObservedValues } from "../../api/testRecords";
import { jitterUs, nonEmptySets } from "./testFormat";

function range(min: number | undefined, max: number | undefined): string | null {
  return min != null || max != null ? `${min ?? "?"}–${max ?? "?"}` : null;
}

type Value = { label: string; value: string; unit: string };

/** A set's single values, in reading order: RF, PRI (or CW / X-let), jitter, frame time, PW, power. */
export function observedValueList(v: ObservedValues): Value[] {
  const out: Value[] = [];
  const add = (label: string, value: string | number | null | undefined, unit = "") => {
    if (value != null) out.push({ label, value: String(value), unit });
  };
  add("RF", v.rf_mean_mhz ?? range(v.rf_min_mhz, v.rf_max_mhz), "MHz");
  if (v.pri_type === "fixed") {
    add("PRI", v.pri_mean_us ?? range(v.pri_min_us, v.pri_max_us), "µs");
    add("Jitter", jitterUs(v), "µs");
  } else if (v.pri_type === "stagger") {
    add("Frame time", v.frame_time_us, "µs");
  } else if (v.pri_type === "cw") {
    add("PRI", "CW");
  } else if (v.pri_type === "xlet") {
    add("PRI", "X-let");
  }
  add("PW", v.pw_mean_us ?? range(v.pw_min_us, v.pw_max_us), "µs");
  add("Power", v.received_power_dbfs, "dBFS");
  return out;
}

/** Steps shown before "Show all" — a long stagger stays a few rows high. */
const STEPS_SHOWN = 12;

/** A stagger's steps as numbered cells of one width, wrapping to fit the
 * column (never spilling out of it), the first few until asked for all. */
function StaggerSteps({ steps }: { steps: number[] }) {
  const [all, setAll] = useState(false);
  // Hiding one or two steps behind a button saves nothing.
  const folds = steps.length > STEPS_SHOWN + 2;
  const shown = folds && !all ? steps.slice(0, STEPS_SHOWN) : steps;
  return (
    <div className="obs-stagger">
      <div className="obs-stagger-head">
        <span className="obs-label">Stagger</span> {steps.length} step{steps.length === 1 ? "" : "s"},{" "}
        <span className="obs-num">
          {Math.min(...steps)}–{Math.max(...steps)}
        </span>{" "}
        <span className="obs-unit">µs</span>
      </div>
      <ol className="obs-steps">
        {shown.map((s, i) => (
          <li key={i}>
            <span className="obs-step-n">{i + 1}</span>
            <span className="obs-num">{s}</span>
          </li>
        ))}
      </ol>
      {folds && (
        <button type="button" className="link-button obs-more" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${steps.length} steps`}
        </button>
      )}
    </div>
  );
}

/** Intercepted parameters inside a table cell: each set on its own lines
 * (numbered when there are several), each value with its label and unit,
 * wrapping to the column's width. */
export function ObservedValuesTable({ sets, empty = "—" }: { sets: ObservedValues[] | null | undefined; empty?: string }) {
  const list = nonEmptySets(sets);
  if (list.length === 0) return <>{empty}</>;
  return (
    <div className="obs-sets">
      {list.map((v, i) => {
        const values = observedValueList(v);
        const steps = v.pri_type === "stagger" ? (v.pri_stagger_values_us ?? []) : [];
        return (
          <div key={i} className="obs-set">
            {list.length > 1 && <span className="obs-set-n">Set {i + 1}</span>}
            {values.length > 0 && (
              <dl className="obs-values">
                {values.map((x) => (
                  <div key={x.label}>
                    <dt className="obs-label">{x.label}</dt>
                    <dd>
                      <span className="obs-num">{x.value}</span>
                      {x.unit && <span className="obs-unit"> {x.unit}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {steps.length > 0 && <StaggerSteps steps={steps} />}
          </div>
        );
      })}
    </div>
  );
}
