import { useState, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import { ApiRequestError } from "../../api/client";
import {
  useCreateInterceptEntry,
  useReplaceInterceptEntry,
} from "../../state/hooks/useIntercepts";
import type { InterceptEntryInput } from "../../api/intercepts";
import type { InterceptEntry } from "../../types/domain";

type EntryPriType = "fixed" | "stagger" | "cw";

const TYPE_LABEL: Record<EntryPriType, string> = {
  fixed: "Fixed PRI",
  stagger: "Stagger",
  cw: "CW",
};

const str = (v: number | null | undefined) => (v == null ? "" : String(v));
const num = (v: string) => (v.trim() === "" ? null : Number(v));

function parseStagger(text: string): number[] {
  return text
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
}

/** Add an entry to an Intercept, or correct one. The means are what's
 * required; measured min/max sit behind a toggle since most readings don't
 * have them. RF, PRI, PW order, as everywhere values are typed. */
export function EntryFormModal({
  interceptId,
  entry,
  onClose,
}: {
  interceptId: string;
  entry?: InterceptEntry;
  onClose: () => void;
}) {
  const createEntry = useCreateInterceptEntry(interceptId);
  const replaceEntry = useReplaceInterceptEntry(interceptId);
  const [priType, setPriType] = useState<EntryPriType>(
    entry?.pri_type === "stagger" || entry?.pri_type === "cw"
      ? entry.pri_type
      : "fixed",
  );
  const [rfMean, setRfMean] = useState(str(entry?.rf_mean_mhz));
  const [priMean, setPriMean] = useState(str(entry?.pri_mean_us));
  const [jitterMean, setJitterMean] = useState(
    entry ? str(entry.jitter_mean_us) || "0" : "0",
  );
  const [stagger, setStagger] = useState(
    entry?.stagger_values?.join(", ") ?? "",
  );
  const [pwMean, setPwMean] = useState(str(entry?.pw_mean_us));
  const hasRanges = [
    entry?.rf_min_mhz,
    entry?.rf_max_mhz,
    entry?.pri_min_us,
    entry?.pri_max_us,
    entry?.pw_min_us,
    entry?.pw_max_us,
  ].some((v) => v != null);
  const [showRanges, setShowRanges] = useState(hasRanges);
  const [rfMin, setRfMin] = useState(str(entry?.rf_min_mhz));
  const [rfMax, setRfMax] = useState(str(entry?.rf_max_mhz));
  const [priMin, setPriMin] = useState(str(entry?.pri_min_us));
  const [priMax, setPriMax] = useState(str(entry?.pri_max_us));
  const [pwMin, setPwMin] = useState(str(entry?.pw_min_us));
  const [pwMax, setPwMax] = useState(str(entry?.pw_max_us));
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const pending = createEntry.isPending || replaceEntry.isPending;

  const staggerValues = parseStagger(stagger);
  const staggerValid =
    staggerValues.length > 0 && staggerValues.every((v) => Number.isFinite(v));
  // A stagger's frame time is the sum of its positions unless measured directly.
  const staggerSum = staggerValid
    ? Math.round(staggerValues.reduce((a, b) => a + b, 0) * 1000) / 1000
    : null;
  const priLabel = priType === "stagger" ? "Frame time" : "PRI";
  // A continuous wave has no pulses: RF only.
  const pulsed = priType !== "cw";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (priType === "stagger" && !staggerValid) {
      setError("Stagger values must be numbers, separated by commas.");
      return;
    }
    const priMeanValue = pulsed
      ? (num(priMean) ?? (priType === "stagger" ? staggerSum : null))
      : null;
    if (pulsed && priMeanValue == null) {
      setError(`${priLabel} mean is required.`);
      return;
    }
    const input: InterceptEntryInput = {
      pri_type: priType,
      rf_mean_mhz: Number(rfMean),
      pri_mean_us: priMeanValue,
      pw_mean_us: pulsed ? Number(pwMean) : null,
      jitter_mean_us: priType === "fixed" ? (num(jitterMean) ?? 0) : null,
      stagger_values: priType === "stagger" ? staggerValues : null,
      rf_min_mhz: showRanges ? num(rfMin) : null,
      rf_max_mhz: showRanges ? num(rfMax) : null,
      pri_min_us: showRanges && pulsed ? num(priMin) : null,
      pri_max_us: showRanges && pulsed ? num(priMax) : null,
      pw_min_us: showRanges && pulsed ? num(pwMin) : null,
      pw_max_us: showRanges && pulsed ? num(pwMax) : null,
      notes: notes.trim() || null,
    };
    try {
      if (entry) await replaceEntry.mutateAsync({ entryId: entry.id, input });
      else await createEntry.mutateAsync(input);
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Failed to save entry",
      );
    }
  }

  const numberInput = (
    value: string,
    set: (v: string) => void,
    opts: { required?: boolean; placeholder?: string } = {},
  ) => (
    <input
      type="number"
      step="any"
      className="edit-input"
      value={value}
      onChange={(e) => set(e.target.value)}
      required={opts.required}
      placeholder={opts.placeholder}
    />
  );

  return (
    <Modal title={entry ? "Edit entry" : "Add entry"} onClose={onClose} wide>
      <form className="edit-fields entry-form" onSubmit={handleSubmit}>
        <div
          className="theme-toggle entry-type-toggle"
          role="group"
          aria-label="PRI type"
        >
          {(["fixed", "stagger", "cw"] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={priType === t}
              className={priType === t ? "active" : ""}
              onClick={() => setPriType(t)}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>

        <div className="entry-form-grid">
          <label>
            RF mean (MHz)
            {numberInput(rfMean, setRfMean, { required: true })}
          </label>
          {pulsed && (
            <label>
              {priLabel} mean (µs)
              {numberInput(priMean, setPriMean, {
                required: priType === "fixed",
                placeholder:
                  priType === "stagger" && staggerSum != null
                    ? `${staggerSum} (sum)`
                    : undefined,
              })}
            </label>
          )}
          {priType === "fixed" ? (
            <label>
              Jitter mean (µs)
              {numberInput(jitterMean, setJitterMean, { required: true })}
            </label>
          ) : priType === "stagger" ? (
            <label>
              Stagger values (µs, in order)
              <input
                className="edit-input"
                value={stagger}
                onChange={(e) => setStagger(e.target.value)}
                placeholder="780, 820, 790, 830"
                required
              />
            </label>
          ) : null}
          {pulsed && (
            <label>
              PW mean (µs)
              {numberInput(pwMean, setPwMean, { required: true })}
            </label>
          )}
        </div>
        {!pulsed && (
          <p className="hint-text">
            A continuous wave has no pulses, so only RF is recorded.
          </p>
        )}
        {priType === "stagger" && (
          <p className="hint-text">
            Leave the frame time mean blank to use the sum of the stagger
            values.
          </p>
        )}

        <button
          type="button"
          className="link-button"
          aria-expanded={showRanges}
          onClick={() => setShowRanges((v) => !v)}
        >
          {showRanges ? "▾ Measured min / max" : "▸ Add measured min / max"}
        </button>
        {showRanges && (
          <div className="entry-form-grid ranges">
            <label>
              RF min (MHz)
              {numberInput(rfMin, setRfMin)}
            </label>
            <label>
              RF max (MHz)
              {numberInput(rfMax, setRfMax)}
            </label>
            {pulsed && (
              <>
                <label>
                  {priLabel} min (µs)
                  {numberInput(priMin, setPriMin)}
                </label>
                <label>
                  {priLabel} max (µs)
                  {numberInput(priMax, setPriMax)}
                </label>
                <label>
                  PW min (µs)
                  {numberInput(pwMin, setPwMin)}
                </label>
                <label>
                  PW max (µs)
                  {numberInput(pwMax, setPwMax)}
                </label>
              </>
            )}
          </div>
        )}

        <label>
          Notes
          <textarea
            className="edit-input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        {entry && entry.derived_mode_ids.length > 0 && (
          <p className="hint-text">
            {entry.derived_mode_ids.length === 1
              ? "A Mode was"
              : `${entry.derived_mode_ids.length} Modes were`}{" "}
            created from this entry. It stays linked, but its values don't
            change.
          </p>
        )}
        {error && <div className="error-text">{error}</div>}
        <div className="edit-actions">
          <button type="submit" className="button primary" disabled={pending}>
            {pending ? "Saving…" : entry ? "Save entry" : "Add entry"}
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
