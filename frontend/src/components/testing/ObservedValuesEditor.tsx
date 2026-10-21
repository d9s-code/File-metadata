import { useEffect, useRef, useState } from "react";
import type { ObservedValues } from "../../api/testRecords";
import type { PriType } from "../../types/domain";
import { nsOf, usOfNs } from "./testFormat";

const PRI_TYPES: PriType[] = ["fixed", "stagger", "cw", "xlet"];

type NumericKey = "rf_mean_mhz" | "pri_mean_us" | "jitter_mean_us" | "pw_mean_us" | "frame_time_us";

// Intercepted parameters are logged as means: RF, the PRI type and its PRI
// (a fixed PRI's mean, a stagger's frame time), PW, then a fixed PRI's
// jitter or a stagger's steps.

/** Jitter and stagger steps are typed in ns but stored in µs, like every other time. */
function nsFromUs(us: number | undefined): string {
  return us == null ? "" : String(nsOf(us));
}

/** A stagger's steps, typed in ns and kept in µs. Holds what's typed, so a
 * trailing comma or a half-typed number stays while the list is written. */
function StaggerNsInput({ valuesUs, onChange }: { valuesUs: number[] | undefined; onChange: (us: number[]) => void }) {
  const [text, setText] = useState(() => (valuesUs ?? []).map(nsOf).join(", "));
  return (
    <input
      placeholder="1250, 1310, 1280"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(
          e.target.value
            .split(/[,;\s]+/)
            .filter(Boolean)
            .map(Number)
            .filter((n) => Number.isFinite(n))
            .map(usOfNs),
        );
      }}
    />
  );
}

// Keys of every PRI-type-specific value, including those on sets logged
// before means were introduced.
const PRI_SPECIFIC_KEYS: (keyof ObservedValues)[] = [
  "pri_mean_us",
  "jitter_mean_us",
  "pri_min_us",
  "pri_max_us",
  "jitter_min_us",
  "jitter_max_us",
  "pri_stagger_values_us",
  "frame_time_us",
];

/** Edits zero or more sets of intercepted/observed parameters — one set per
 * separate measurement. */
export function ObservedValuesEditor({
  sets,
  onChange,
  autoFocus = false,
}: {
  sets: ObservedValues[];
  onChange: (sets: ObservedValues[]) => void;
  /** Put the cursor in the first field when it opens (after "+ Log"), so the
   * values can be typed straight in, tabbing from one to the next. */
  autoFocus?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  // With nothing logged yet, opening it starts the first set of fields, so
  // there's something to type into; the cursor goes to its first field.
  const focusPending = useRef(autoFocus);
  useEffect(() => {
    if (autoFocus && sets.length === 0) onChange([{}]);
    // Only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!focusPending.current || sets.length === 0) return;
    focusPending.current = false;
    rootRef.current?.querySelector<HTMLElement>("input, select")?.focus();
  }, [sets.length]);

  function update(index: number, updater: (set: ObservedValues) => ObservedValues) {
    onChange(sets.map((set, i) => (i === index ? updater(set) : set)));
  }

  function setNumber(index: number, key: NumericKey, raw: string) {
    update(index, (set) => {
      const next = { ...set };
      if (raw === "") delete next[key];
      else next[key] = Number(raw);
      return next;
    });
  }

  function setPriType(index: number, priType: PriType | "") {
    update(index, (set) => {
      // Values for the previous PRI type would contradict the new one.
      const next: ObservedValues = { ...set };
      for (const key of PRI_SPECIFIC_KEYS) delete next[key];
      if (priType === "") delete next.pri_type;
      else next.pri_type = priType;
      return next;
    });
  }

  function setStagger(index: number, values: number[]) {
    update(index, (set) => {
      const next = { ...set };
      if (values.length) next.pri_stagger_values_us = values;
      else delete next.pri_stagger_values_us;
      return next;
    });
  }

  return (
    <div className="mode-observed-values" ref={rootRef}>
      {sets.map((set, index) => (
        <div key={index} className="mode-observed-value-set">
          {sets.length > 1 && <div className="mode-observed-value-set-label">Set {index + 1}</div>}
          {/* One row, in the order they're typed: RF, PRI type and its value, PW, then jitter or steps. */}
          <div className="observed-values-row">
            <MeanInput label="RF mean (MHz)" set={set} field="rf_mean_mhz" onChange={(raw) => setNumber(index, "rf_mean_mhz", raw)} />
            <label>
              PRI type
              <select value={set.pri_type ?? ""} onChange={(e) => setPriType(index, e.target.value as PriType | "")}>
                <option value="">—</option>
                {PRI_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            {set.pri_type === "fixed" && (
              <MeanInput label="PRI mean (µs)" set={set} field="pri_mean_us" onChange={(raw) => setNumber(index, "pri_mean_us", raw)} />
            )}
            {set.pri_type === "stagger" && (
              <label>
                Frame time (µs)
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={set.frame_time_us ?? ""}
                  onChange={(e) => setNumber(index, "frame_time_us", e.target.value)}
                  title="The frame time as measured, if it was — optional"
                />
              </label>
            )}
            <MeanInput label="PW mean (µs)" set={set} field="pw_mean_us" onChange={(raw) => setNumber(index, "pw_mean_us", raw)} />
            {set.pri_type === "fixed" && (
              <label>
                Jitter mean (ns)
                <input
                  type="number"
                  step="any"
                  value={nsFromUs(set.jitter_mean_us)}
                  onChange={(e) =>
                    setNumber(index, "jitter_mean_us", e.target.value === "" ? "" : String(Number(e.target.value) / 1000))
                  }
                />
              </label>
            )}
            {set.pri_type === "stagger" && (
              <label className="observed-values-steps">
                Stagger steps (ns, in order)
                <StaggerNsInput valuesUs={set.pri_stagger_values_us} onChange={(us) => setStagger(index, us)} />
              </label>
            )}
            {(set.pri_type === "cw" || set.pri_type === "xlet") && (
              <span className="hint-text observed-values-note">{set.pri_type.toUpperCase()}: no further PRI value</span>
            )}
            <button
              type="button"
              className="link-button link-button-danger observed-values-remove"
              onClick={() => onChange(sets.filter((_, i) => i !== index))}
            >
              Remove this set
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="icon-button" onClick={() => onChange([...sets, {}])}>
        {sets.length === 0 ? "+ Add intercepted parameters" : "+ Add another set"}
      </button>
    </div>
  );
}

function MeanInput({
  label,
  set,
  field,
  onChange,
}: {
  label: string;
  set: ObservedValues;
  field: NumericKey;
  onChange: (raw: string) => void;
}) {
  return (
    <label>
      {label}
      <input type="number" step="any" value={set[field] ?? ""} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
