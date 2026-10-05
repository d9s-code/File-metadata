import { useState, type FormEvent } from "react";
import { authApi } from "../../api/auth";
import { ApiRequestError } from "../../api/client";
import { Modal } from "./Modal";

const MIN_LENGTH = 12;

/** Changing your own password: the current one, then the new one twice.
 * Afterwards every other place you're signed in is signed out. */
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const mismatch = again.length > 0 && again !== next;
  const ready = current && next.length >= MIN_LENGTH && again === next;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    setSaving(true);
    try {
      await authApi.changePassword(current, next);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't change the password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Change password" onClose={onClose}>
      {done ? (
        <>
          <p>Your password has been changed. Anywhere else you were signed in has been signed out.</p>
          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <form className="change-password-form" onSubmit={(e) => void submit(e)}>
          <label>
            Current password
            <input type="password" aria-label="Current password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
          </label>
          <label>
            New password
            <input
              type="password"
              aria-label="New password"
              aria-describedby="new-password-hint"
              autoComplete="new-password"
              value={next}
              aria-invalid={tooShort || undefined}
              onChange={(e) => setNext(e.target.value)}
            />
            <span id="new-password-hint" className={tooShort ? "line-row-problem" : "hint-text"}>At least {MIN_LENGTH} characters — a few words make a good one.</span>
          </label>
          <label>
            New password again
            <input
              type="password"
              aria-label="New password again"
              autoComplete="new-password"
              value={again}
              aria-invalid={mismatch || undefined}
              onChange={(e) => setAgain(e.target.value)}
            />
            {mismatch && <span className="line-row-problem">The two new passwords don&apos;t match</span>}
          </label>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <p className="hint-text">Anywhere else you&apos;re signed in will be signed out.</p>
          <div className="modal-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={!ready || saving}>
              {saving ? "Changing…" : "Change password"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
