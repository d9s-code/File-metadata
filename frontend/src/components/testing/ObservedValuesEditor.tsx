import type { ObservedValues } from "../../api/testRecords";
import type { PriType } from "../../types/domain";

const PRI_TYPES: PriType[] = ["fixed", "stagger", "cw", "xlet"];

type NumericKey = "rf_mean_mhz" | "pri_mean_us" | "jitter_mean_us" | "pw_mean_us" | "frame_time_us";

// Intercepted parameters are logged as means, laid out RF, then PRI, then
// PW — the same order as the Mode forms.
const FIXED_PRI_FIELDS: { key: NumericKey; label: string }[] = [
  { key: "pri_mean_us", label: "PRI mean (µs)" },
  { key: "jitter_mean_us", label: "jitter mean (µs)" },
];

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
}: {
  sets: ObservedValues[];
  onChange: (sets: ObservedValues[]) => void;
}) {
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

  function setStagger(index: number, raw: string) {
    update(index, (set) => {
      const values = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number);
      const next = { ...set };
      if (values.length) next.pri_stagger_values_us = values;
      else delete next.pri_stagger_values_us;
      return next;
    });
  }

  return (
    <div className="mode-observed-values">
      {sets.map((set, index) => (
        <div key={index} className="mode-observed-value-set">
          {sets.length > 1 && <div className="mode-observed-value-set-label">Set {index + 1}</div>}
          <div className="form-row">
            <MeanInput label="RF mean (MHz)" set={set} field="rf_mean_mhz" onChange={(raw) => setNumber(index, "rf_mean_mhz", raw)} />
          </div>
          <div className="form-row">
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
            {set.pri_type === "fixed" &&
              FIXED_PRI_FIELDS.map(({ key, label }) => (
                <label key={key}>
                  {label}
                  <input
                    type="number"
                    step="any"
                    value={set[key] ?? ""}
                    onChange={(e) => setNumber(index, key, e.target.value)}
                  />
                </label>
              ))}
            {set.pri_type === "stagger" && (
              <>
                <label className="wide-label">
                  PRI stagger sequence (comma-separated µs, in order)
                  <input
                    placeholder="800, 850, 900, 780"
                    value={set.pri_stagger_values_us?.join(", ") ?? ""}
                    onChange={(e) => setStagger(index, e.target.value)}
                  />
                </label>
                <label>
                  frame time (µs)
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={set.frame_time_us ?? ""}
                    onChange={(e) => setNumber(index, "frame_time_us", e.target.value)}
                    title="The frame time as measured, if it was — optional"
                  />
                </label>
              </>
            )}
          </div>
          {(set.pri_type === "cw" || set.pri_type === "xlet") && (
            <p className="hint-text">{set.pri_type.toUpperCase()}: no further PRI value to record.</p>
          )}
          <div className="form-row">
            <MeanInput label="PW mean (µs)" set={set} field="pw_mean_us" onChange={(raw) => setNumber(index, "pw_mean_us", raw)} />
          </div>
          <button
            type="button"
            className="link-button link-button-danger"
            onClick={() => onChange(sets.filter((_, i) => i !== index))}
          >
            Remove this set
          </button>
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
