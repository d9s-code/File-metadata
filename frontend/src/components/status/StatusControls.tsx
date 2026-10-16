import { useState } from "react";
import { ApiRequestError } from "../../api/client";
import { unmetMilestones, type StatusEntityType } from "../../api/statuses";
import { RequireRole } from "../../auth/RequireAuth";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { useItemMilestones, useStatuses } from "../../state/hooks/useStatuses";

/** "Move to …" buttons for the moves Admins allow from the current status.
 * A status that asks for a note opens a note box first; one whose
 * milestones aren't all met shows how many are, and asks to confirm the
 * move with the open ones listed. */
export function StatusControls({
  type,
  itemId,
  status,
  move,
  disabledTitle,
  beforeMove,
}: {
  type: StatusEntityType;
  itemId: string;
  status: string;
  /** Does the move; returns what to say once done. */
  move: (newStatus: string, note: string | undefined, confirmUnmet: boolean) => Promise<string | void>;
  /** Set to block every move, with the reason. */
  disabledTitle?: string;
  /** A last check before moving (e.g. an MDF's readiness warnings); false stops it. */
  beforeMove?: (next: string, label: string, confirm: ReturnType<typeof useConfirmDialog>["confirmDelete"]) => Promise<boolean>;
}) {
  const statuses = useStatuses(type);
  const { data: milestones } = useItemMilestones(type, itemId);
  const [pendingNext, setPendingNext] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const { confirmDelete: confirm, dialog } = useConfirmDialog();

  const current = statuses.byKey[status];
  const nexts = (current?.transitions ?? []).filter((k) => statuses.byKey[k]);

  function progress(key: string) {
    const list = (milestones ?? []).filter((m) => m.status_key === key);
    return list.length ? { met: list.filter((m) => m.done).length, total: list.length } : null;
  }

  async function doMove(next: string, noteText?: string) {
    const label = statuses.label(next);
    setError(null);
    setDone(null);
    if (beforeMove && !(await beforeMove(next, label, confirm))) return;
    setBusy(true);
    try {
      let message: string | void;
      try {
        message = await move(next, noteText, false);
      } catch (err) {
        const unmet = err instanceof ApiRequestError ? unmetMilestones(err.detail) : null;
        if (!unmet) throw err;
        const ok = await confirm(
          `Not every milestone for ${label} is met:\n\n${unmet.unmet_milestones.map((t) => `• ${t}`).join("\n")}\n\nMove to ${label} anyway?`,
          { confirmLabel: `Move to ${label} anyway` },
        );
        if (!ok) return;
        message = await move(next, noteText, true);
      }
      setPendingNext(null);
      setNote("");
      setDone(message || `Moved to ${label}.`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't change the status");
    } finally {
      setBusy(false);
    }
  }

  function handleClick(next: string) {
    if (statuses.byKey[next]?.requires_note) {
      setError(null);
      setPendingNext(next);
    } else {
      void doMove(next);
    }
  }

  return (
    <RequireRole minimum="editor">
      <div className="status-controls">
        {nexts.map((next) => {
          const p = progress(next);
          return (
            <button
              key={next}
              className="status-transition-button"
              onClick={() => handleClick(next)}
              disabled={busy || !!disabledTitle}
              title={disabledTitle ?? (p ? `${p.met} of ${p.total} milestones for it met` : undefined)}
            >
              Move to {statuses.label(next)}
              {p && (
                <span className={p.met === p.total ? "milestone-count met" : "milestone-count"}>
                  {p.met}/{p.total}
                </span>
              )}
            </button>
          );
        })}
        {error && <span className="error-text">{error}</span>}
        {done && !error && (
          <span className="hint-text status-done" role="status">
            {done}
          </span>
        )}
      </div>
      {pendingNext && (
        <div className="status-note-form">
          <label>
            {statuses.byKey[pendingNext]?.note_prompt || `Note for ${statuses.label(pendingNext)}`} (required)
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} autoFocus />
          </label>
          <div className="modal-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setPendingNext(null);
                setNote("");
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!note.trim() || busy || !!disabledTitle}
              onClick={() => void doMove(pendingNext, note.trim())}
            >
              Move to {statuses.label(pendingNext)}
            </button>
          </div>
        </div>
      )}
      {dialog}
    </RequireRole>
  );
}
