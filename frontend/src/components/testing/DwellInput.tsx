import { useEffect, useState } from "react";

export const MANUAL_DWELL = "Manual";

/** A run's dwell: "Manual", or a value written in (e.g. "50 ms"). */
export function DwellInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const isManual = value === MANUAL_DWELL;
  // Keeps what was typed, so switching to Manual and back doesn't lose it.
  const [written, setWritten] = useState(isManual ? "" : value);
  // A value set from outside (e.g. copied from a previous run) counts as written.
  useEffect(() => {
    if (!isManual) setWritten(value);
  }, [isManual, value]);
  return (
    <label>
      Dwell
      <span className="dwell-input">
        <select
          aria-label="Dwell type"
          value={isManual ? "manual" : "value"}
          onChange={(e) => onChange(e.target.value === "manual" ? MANUAL_DWELL : written)}
        >
          <option value="manual">Manual</option>
          <option value="value">Value…</option>
        </select>
        {!isManual && (
          <input
            aria-label="Dwell value"
            placeholder="e.g. 50 ms"
            maxLength={100}
            value={value}
            onChange={(e) => {
              setWritten(e.target.value);
              onChange(e.target.value);
            }}
            required
          />
        )}
      </span>
    </label>
  );
}
