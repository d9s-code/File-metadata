import { useState, type ReactNode } from "react";
import { DerivedFromPicker } from "./DerivedFromPicker";

/** Written to the PRS export — 100 % and 2 unless a Mode says otherwise. */
export const DEFAULT_CONFIRMATION_QUALITY = 100;
export const DEFAULT_CONFIRMATION_QUANTITY = 2;

export interface MoreOptionsValues {
  quality: string;
  quantity: string;
  notes: string;
  derivedFrom: Set<string>;
}

/** What's wrong with the confirmation numbers, if anything. */
export function confirmationProblem(quality: string, quantity: string): string | null {
  const q = Number(quality);
  const n = Number(quantity);
  if (quality.trim() === "" || !Number.isInteger(q) || q < 0 || q > 100) return "Confirmation quality is a whole number from 0 to 100";
  if (quantity.trim() === "" || !Number.isInteger(n) || n < 1) return "Confirmation quantity is a whole number, 1 or more";
  return null;
}

/** The fields most Modes leave alone — confirmation, notes,
 * test-derived — folded into one line that says what they're set to. */
export function ModeMoreOptions({
  values,
  onChange,
  emitterId,
  showDerived,
  forceOpen,
  extra,
}: {
  values: MoreOptionsValues;
  onChange: (part: Partial<MoreOptionsValues>) => void;
  emitterId: string;
  /** Offer "test-derived" — not when the form already fixes where the Mode came from. */
  showDerived: boolean;
  /** Open regardless, e.g. when something in here needs fixing. */
  forceOpen?: boolean;
  extra?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [showPicker, setShowPicker] = useState(values.derivedFrom.size > 0);
  const problem = confirmationProblem(values.quality, values.quantity);
  const isOpen = open || !!forceOpen || !!problem;
  const summary = [
    `Confirmation ${values.quality || "?"} % × ${values.quantity || "?"}`,
    values.notes.trim() ? "has notes" : "no notes",
    values.derivedFrom.size > 0 && `test-derived (${values.derivedFrom.size})`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={isOpen ? "mode-more open" : "mode-more"}>
      <button type="button" className="mode-more-toggle" aria-expanded={isOpen} onClick={() => setOpen((o) => !o)}>
        <span>{isOpen ? "▾" : "▸"} More options</span>
        {!isOpen && <span className="hint-text">{summary}</span>}
      </button>
      {isOpen && (
        <div className="mode-more-body">
          <div className="mode-form-grid">
            <label title="Written to the PRS export">
              Confirmation quality (0–100)
              <input
                type="number"
                step="1"
                min="0"
                max="100"
                value={values.quality}
                aria-invalid={!!problem || undefined}
                onChange={(e) => onChange({ quality: e.target.value })}
              />
            </label>
            <label title="Written to the PRS export">
              Confirmation quantity
              <input
                type="number"
                step="1"
                min="1"
                value={values.quantity}
                aria-invalid={!!problem || undefined}
                onChange={(e) => onChange({ quantity: e.target.value })}
              />
            </label>
          </div>
          {problem && (
            <p className="line-row-problem" role="alert">
              {problem}
            </p>
          )}
          <label>
            Notes
            <textarea
              rows={2}
              placeholder="Any context worth recording about this Mode…"
              value={values.notes}
              onChange={(e) => onChange({ notes: e.target.value })}
            />
          </label>
          {extra}
          {showDerived &&
            (showPicker ? (
              <div>
                <h5>Explained by test result(s)</h5>
                <DerivedFromPicker
                  emitterId={emitterId}
                  selected={values.derivedFrom}
                  onChange={(derivedFrom) => onChange({ derivedFrom })}
                />
              </div>
            ) : (
              <button type="button" className="link-button" onClick={() => setShowPicker(true)}>
                + This Mode is test-derived (not from the Source)
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
