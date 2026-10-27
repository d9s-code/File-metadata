import { useEffect, useState, type FormEvent } from "react";
import { AdminNav } from "../components/common/AdminNav";
import { LoadingState } from "../components/common/LoadingState";
import { ApiRequestError } from "../api/client";
import type { ModeDefaults } from "../api/dwells";
import { BUILT_IN_MODE_DEFAULTS, useAppSettings, useUpdateAppSettings } from "../state/hooks/useDwells";

type Key = keyof ModeDefaults;
type Texts = Record<Key, string>;

const FIELDS: { key: Key; label: string; unit: string; hint: string; whole?: boolean; min: number; max?: number }[] = [
  { key: "confirmation_quality", label: "Confirmation quality", unit: "%", hint: "0–100", whole: true, min: 0, max: 100 },
  { key: "confirmation_quantity", label: "Confirmation quantity", unit: "", hint: "1 or more", whole: true, min: 1 },
  { key: "rf_delta", label: "RF margin", unit: "± MHz", hint: "", min: 0 },
  { key: "pri_delta", label: "PRI margin (Fixed)", unit: "± µs", hint: "", min: 0 },
  { key: "pw_delta", label: "PW margin", unit: "± µs", hint: "", min: 0 },
  {
    key: "frame_time_delta_us",
    label: "Frame-time margin (Stagger)",
    unit: "± µs",
    hint: "on the frame time — the sum of the steps — not on each step",
    min: 0,
  },
];

const textsOf = (d: ModeDefaults): Texts =>
  Object.fromEntries(FIELDS.map((f) => [f.key, String(d[f.key])])) as Texts;

function problem(f: (typeof FIELDS)[number], text: string): string | null {
  if (text.trim() === "") return "Needs a value";
  const v = Number(text);
  if (!Number.isFinite(v)) return "Not a number";
  if (f.whole && !Number.isInteger(v)) return "A whole number";
  if (v < f.min || (f.max != null && v > f.max)) return f.hint || `At least ${f.min}`;
  return null;
}

/** What a new Mode starts with: its confirmation, and the margins the Add
 * Mode form and the Intercept planning page fill in. Modes made without a
 * form (from Elements, a typed line, the AI chat) get the confirmation and,
 * for a stagger, the frame-time margin. Existing Modes don't change. */
export function AdminDefaultsPage() {
  const { data: settings, isLoading } = useAppSettings();
  const update = useUpdateAppSettings();
  const saved = settings?.mode_defaults;
  const [texts, setTexts] = useState<Texts | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (saved && texts === null) setTexts(textsOf(saved));
  }, [saved, texts]);

  if (isLoading || !saved || !texts) return <LoadingState label="Loading the defaults…" />;

  const problems = Object.fromEntries(FIELDS.map((f) => [f.key, problem(f, texts[f.key])])) as Record<Key, string | null>;
  const changed = FIELDS.filter((f) => Number(texts[f.key]) !== saved[f.key] || texts[f.key].trim() === "").length;
  const builtIn = FIELDS.every((f) => Number(texts[f.key]) === BUILT_IN_MODE_DEFAULTS[f.key]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    if (Object.values(problems).some(Boolean)) return setError("Fix the values marked first.");
    const next = Object.fromEntries(FIELDS.map((f) => [f.key, Number(texts![f.key])])) as unknown as ModeDefaults;
    try {
      const out = await update.mutateAsync({ mode_defaults: next });
      setTexts(textsOf(out.mode_defaults));
      setMessage("Saved — new Modes start with these.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save them.");
    }
  }

  const row = (f: (typeof FIELDS)[number]) => (
    <label key={f.key} className="defaults-field">
      <span>{f.label}</span>
      <span className="defaults-input">
        <input
          type="number"
          step={f.whole ? 1 : "any"}
          min={f.min}
          max={f.max}
          value={texts[f.key]}
          aria-invalid={!!problems[f.key]}
          onChange={(e) => {
            setTexts({ ...texts, [f.key]: e.target.value });
            setMessage(null);
          }}
        />
        {f.unit && <span className="hint-text">{f.unit}</span>}
      </span>
      {problems[f.key] ? (
        <span className="error-text">{problems[f.key]}</span>
      ) : (
        f.hint && !f.whole && <span className="hint-text">{f.hint}</span>
      )}
    </label>
  );

  return (
    <div className="page">
      <h1>Admin</h1>
      <AdminNav />
      <form className="card" onSubmit={handleSubmit}>
        <h3>Mode defaults</h3>
        <p className="hint-text">
          What a new Mode starts with. The Add Mode form and the Intercept planning page fill these in (they can be
          changed there for one Mode); Modes made from Elements, a typed line or the AI chat get the confirmation and,
          for a Stagger, the frame-time margin. Existing Modes keep theirs.
        </p>
        <fieldset className="defaults-group">
          <legend>Confirmation</legend>
          {FIELDS.slice(0, 2).map(row)}
        </fieldset>
        <fieldset className="defaults-group">
          <legend>Margins</legend>
          {FIELDS.slice(2).map(row)}
        </fieldset>
        <div className="form-row">
          <button type="submit" className="button primary" disabled={update.isPending || changed === 0}>
            {update.isPending ? "Saving…" : changed ? `Save ${changed} change${changed === 1 ? "" : "s"}` : "Saved"}
          </button>
          {changed > 0 && (
            <button type="button" className="button secondary" onClick={() => setTexts(textsOf(saved))}>
              Discard
            </button>
          )}
          {!builtIn && (
            <button type="button" className="button secondary" onClick={() => setTexts(textsOf(BUILT_IN_MODE_DEFAULTS))}>
              Back to the built-in defaults
            </button>
          )}
        </div>
        {message && <p className="success-text">{message}</p>}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
