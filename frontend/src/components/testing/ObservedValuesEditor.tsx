import type { ObservedValues } from "../../api/testRecords";
import type { PriType } from "../../types/domain";

const PRI_TYPES: PriType[] = ["fixed", "stagger", "cw", "xlet"];

type NumericKey =
  | "rf_min_mhz"
  | "rf_max_mhz"
  | "pw_min_us"
  | "pw_max_us"
  | "pri_min_us"
  | "pri_max_us"
  | "jitter_min_us"
  | "jitter_max_us";

const BASE_FIELDS: { key: NumericKey; label: string }[] = [
  { key: "rf_min_mhz", label: "RF min (MHz)" },
  { key: "rf_max_mhz", label: "RF max (MHz)" },
  { key: "pw_min_us", label: "PW min (µs)" },
  { key: "pw_max_us", label: "PW max (µs)" },
];

const FIXED_PRI_FIELDS: { key: NumericKey; label: string }[] = [
  { key: "pri_min_us", label: "PRI min (µs)" },
  { key: "pri_max_us", label: "PRI max (µs)" },
  { key: "jitter_min_us", label: "jitter min (µs)" },
  { key: "jitter_max_us", label: "jitter max (µs)" },
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
      delete next.pri_min_us;
      delete next.pri_max_us;
      delete next.jitter_min_us;
      delete next.jitter_max_us;
      delete next.pri_stagger_values_us;
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
            {BASE_FIELDS.map(({ key, label }) => (
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
          </div>
          {set.pri_type === "fixed" && (
            <div className="form-row">
              {FIXED_PRI_FIELDS.map(({ key, label }) => (
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
            </div>
          )}
          {set.pri_type === "stagger" && (
            <div className="form-row">
              <label className="wide-label">
                PRI stagger sequence (comma-separated µs, in order)
                <input
                  placeholder="800, 850, 900, 780"
                  value={set.pri_stagger_values_us?.join(", ") ?? ""}
                  onChange={(e) => setStagger(index, e.target.value)}
                />
              </label>
            </div>
          )}
          {(set.pri_type === "cw" || set.pri_type === "xlet") && (
            <p className="hint-text">{set.pri_type.toUpperCase()}: no further PRI value to record.</p>
          )}
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
