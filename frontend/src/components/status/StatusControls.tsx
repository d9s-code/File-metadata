import { useState } from "react";
import { ApiRequestError } from "../../api/client";
import { unmetMilestones, type StatusEntityType } from "../../api/statuses";
import { useHasRole } from "../../auth/RequireAuth";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { MenuButton } from "../common/MenuButton";
import { Modal } from "../common/Modal";
import { useItemMilestones, useStatuses } from "../../state/hooks/useStatuses";
import { StatusBadge } from "./StatusBadge";

/** The status, as a coloured chip that opens the moves Admins allow from it
 * ("Testing ▾" → Move to Operational 2/3 …). A status that asks for a note
 * asks for it first; one whose milestones aren't all met shows how many are,
 * and asks to confirm the move with the open ones listed. Viewers, and a
 * status with nowhere to go, get the plain badge. No version is saved for a
 * move — status is where something stands, not part of its content. */
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
  const canMove = useHasRole("editor");
  const { data: milestones } = useItemMilestones(type, itemId);
  const [pendingNext, setPendingNext] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    if (beforeMove && !(await beforeMove(next, label, confirm))) return;
    setBusy(true);
    try {
      try {
        await move(next, noteText, false);
      } catch (err) {
        const unmet = err instanceof ApiRequestError ? unmetMilestones(err.detail) : null;
        if (!unmet) throw err;
        const ok = await confirm(
          `Not every milestone for ${label} is met:\n\n${unmet.unmet_milestones.map((t) => `• ${t}`).join("\n")}\n\nMove to ${label} anyway?`,
          { confirmLabel: `Move to ${label} anyway` },
        );
        if (!ok) return;
        await move(next, noteText, true);
      }
      setPendingNext(null);
      setNote("");
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

  if (!canMove || nexts.length === 0) return <StatusBadge type={type} status={status} />;

  const color = statuses.color(status);
  return (
    <>
      <MenuButton
        align="start"
        className={`status-badge status-color-${color} status-chip`}
        title={disabledTitle ?? "Change the status"}
        disabled={busy || !!disabledTitle}
        ariaLabel={`Status: ${statuses.label(status)} — change it`}
        label={
          <>
            {statuses.label(status)} <span className="chip-caret">▾</span>
          </>
        }
        items={nexts.map((next) => {
          const p = progress(next);
          return {
            label: (
              <span className="status-menu-item">
                <span className={`status-dot status-color-${statuses.color(next)}`} />
                Move to {statuses.label(next)}
                {p && (
                  <span className={p.met === p.total ? "milestone-count met" : "milestone-count"} title="Milestones met">
                    {p.met}/{p.total}
                  </span>
                )}
              </span>
            ),
            title: statuses.byKey[next]?.requires_note ? "Asks for a note" : undefined,
            onSelect: () => handleClick(next),
          };
        })}
      />
      {error && <span className="error-text">{error}</span>}
      {pendingNext && (
        <Modal
          title={`Move to ${statuses.label(pendingNext)}`}
          onClose={() => {
            setPendingNext(null);
            setNote("");
          }}
        >
          <label>
            {statuses.byKey[pendingNext]?.note_prompt || `Note for ${statuses.label(pendingNext)}`} (required)
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} autoFocus />
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
              className="button primary"
              disabled={!note.trim() || busy || !!disabledTitle}
              onClick={() => void doMove(pendingNext, note.trim())}
            >
              Move to {statuses.label(pendingNext)}
            </button>
          </div>
        </Modal>
      )}
      {dialog}
    </>
  );
}
