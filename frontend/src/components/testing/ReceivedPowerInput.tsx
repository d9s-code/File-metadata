/** A run's Received Power in dBFS — one value for the whole run, required.
 * Kept as typed; `receivedPowerError` says what's wrong with it, if anything. */
export function ReceivedPowerInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className={value.trim() === "" ? "field-missing" : undefined}>
      <span>
        Received Power (dBFS) <span className="required-mark" aria-hidden="true">*</span>
      </span>
      <input
        type="number"
        step="any"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        placeholder="−45"
        title="How strong the signals were received over the run, in dBFS (0 is full scale) — required"
        className="received-power-input"
      />
    </label>
  );
}

export function receivedPowerError(value: string): string | null {
  if (value.trim() === "") return "Give the run's Received Power (dBFS).";
  return Number.isFinite(Number(value)) ? null : "The Received Power (dBFS) must be a number.";
}
