import { useEffect, useRef, useState, type FormEvent } from "react";
import { Modal } from "./Modal";
import { ApiRequestError } from "../../api/client";

/** Renaming one thing — a Mode, an EW Group, a Source — on its own, from its
 * row's ⋯ menu: the name selected, ready to type over; Enter saves. Warns as
 * you type when one of its neighbours already has the name. */
export function RenameDialog({
  what,
  currentName,
  takenNames,
  takenWhere,
  onRename,
  onClose,
}: {
  /** E.g. "EW Group". */
  what: string;
  currentName: string;
  /** Names it can't take (its neighbours'). */
  takenNames: string[];
  /** Where those neighbours are, for the warning: "in this EW Group", "on this Emitter". */
  takenWhere: string;
  onRename: (name: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.select(), []);

  const trimmed = name.trim();
  const clash = trimmed !== currentName && takenNames.includes(trimmed);
  const unchanged = trimmed === currentName;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!trimmed) {
      setError(`Give the ${what} a name.`);
      return;
    }
    if (clash || unchanged) return;
    setSaving(true);
    setError(null);
    try {
      await onRename(trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : `Couldn't rename the ${what}`);
      setSaving(false);
    }
  }

  return (
    <Modal title={`Rename ${what}`} onClose={onClose}>
      <form className="rename-form" onSubmit={handleSubmit}>
        <label>
          Name
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            aria-invalid={clash || !!error || undefined}
          />
        </label>
        {clash ? (
          <p className="mode-form-warning">
            Another {what} {takenWhere} is already called &ldquo;{trimmed}&rdquo;.
          </p>
        ) : (
          <p className="hint-text">Was &ldquo;{currentName}&rdquo;.</p>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={saving || clash || unchanged || !trimmed}>
            {saving ? "Renaming…" : "Rename"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
