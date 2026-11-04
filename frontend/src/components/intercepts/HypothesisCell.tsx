import { useEffect, useRef, useState } from "react";
import { ApiRequestError } from "../../api/client";

/** What the analyst thinks a group of reports is — shown in its table row,
 * and written in place: click, type, Enter (or click away) saves, Esc puts it back. */
export function HypothesisCell({
  value,
  canEdit,
  onSave,
}: {
  value: string | null | undefined;
  canEdit: boolean;
  /** Saves it; a rejection keeps the box open with the problem under it. */
  onSave: (next: string | null) => Promise<unknown> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  async function save() {
    const next = draft.trim() || null;
    if (next === (value ?? null)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save it");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="hypothesis-edit">
        <input
          ref={input}
          value={draft}
          maxLength={2000}
          disabled={saving}
          placeholder="What do you think this is?"
          aria-label="Hypothesis"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            } else if (e.key === "Escape") {
              setDraft(value ?? "");
              setError(null);
              setEditing(false);
            }
          }}
        />
        {error && <div className="error-text">{error}</div>}
      </div>
    );
  }
  if (!canEdit) {
    return value ? <span className="hypothesis-text" title={value}>{value}</span> : <span className="hint-text">—</span>;
  }
  return (
    <button
      type="button"
      className={value ? "hypothesis-button" : "hypothesis-button empty"}
      title={value ? `${value} — click to change` : "Add a hypothesis: what you think this group is"}
      onClick={() => setEditing(true)}
    >
      {value || "+ Hypothesis"}
    </button>
  );
}
