import { useState } from "react";
import { Modal } from "../common/Modal";
import { ApiRequestError } from "../../api/client";
import { RequireRole } from "../../auth/RequireAuth";

/** "Save version" for a Platform or MDF — the same button and dialog as an
 * Emitter's: it saves the current state as a new, permanent version with a
 * summary of what changed. (Platforms and MDFs have no editing session to
 * end, so that's all it does.) */
export function SaveVersionButton({
  noun,
  save,
  pending,
}: {
  /** "Platform" or "MDF", for the dialog's wording. */
  noun: string;
  /** Called with the summary — undefined when left empty (it's optional here). */
  save: (summary: string | undefined) => Promise<unknown>;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      await save(summary.trim() || undefined);
      setSummary("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save the version — nothing was saved.");
    }
  }

  return (
    <RequireRole minimum="editor">
      <button className="button primary" onClick={() => setOpen(true)}>
        Save version
      </button>
      {open && (
        <Modal title="Save version" onClose={() => setOpen(false)} wide>
          <p className="hint-text">
            Saving creates a new, permanent version of this {noun} — it shows up in Version History with your summary
            below, and can be pinned and exported.
          </p>
          <label>
            What changed? (optional)
            <textarea
              className="edit-input"
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="e.g. Pinned the updated APG-99 version"
              autoFocus
            />
          </label>
          {error && <div className="error-text">{error}</div>}
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </button>
            <button className="button primary" onClick={() => void submit()} disabled={pending}>
              {pending ? "Saving…" : "Save version"}
            </button>
          </div>
        </Modal>
      )}
    </RequireRole>
  );
}

/** "Last saved as v3 · 30/09/2026" — or that nothing's saved yet. */
export function LatestVersion({ versions }: { versions: { version_number: number; created_at: string }[] | undefined }) {
  if (!versions) return null;
  const latest = versions.length ? versions[versions.length - 1] : null;
  return (
    <span className="hint-text">
      {latest
        ? `Last saved as v${latest.version_number} · ${new Date(latest.created_at).toLocaleDateString()}`
        : "No saved version yet — save one to pin or export it"}
    </span>
  );
}
