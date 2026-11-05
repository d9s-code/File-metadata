import { useState } from "react";
import { Icon } from "../common/Icon";
import { formatDateTime } from "../common/dates";
import type { Emitter } from "../../types/domain";
import { useAuth } from "../../auth/AuthContext";
import { RequireRole } from "../../auth/RequireAuth";
import {
  useCheckinEmitter,
  useCheckoutEmitter,
  useDiscardEmitterChanges,
  useEmitterCheckoutState,
} from "../../state/hooks/useEmitterCheckout";
import {
  latestSaves,
  useCommitEmitterVersion,
  useEmitterHistory,
  useEmitterHistoryDiff,
  useEmitterLiveDiff,
  useSaveCheckpoint,
} from "../../state/hooks/useEmitterVersions";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { ApiRequestError } from "../../api/client";
import { EmitterDiffViewer } from "./EmitterDiffViewer";
import { Modal } from "../common/Modal";

/** The Emitter's edit-mode controls, for the page header: Start editing
 * when nobody holds the checkout; Save checkpoint / Save version / Discard
 * (and a link to the changes so far) while you do; who holds it otherwise.
 * A checkpoint (v3.1) is a save along the way that keeps you editing; a
 * version (v4) is what Platforms pin, exports use and tests count against. */
export function EditModeControls({
  emitter,
  onDiscarded,
  showingChanges,
  onToggleChanges,
}: {
  emitter: Emitter;
  onDiscarded?: () => void;
  showingChanges?: boolean;
  /** Leave out to hide the Changes toggle (e.g. where there's no panel to show them in). */
  onToggleChanges?: () => void;
}) {
  const { user } = useAuth();
  const { isCheckedOut, isMine, holderUsername, checkedOutAt } = useEmitterCheckoutState(emitter);
  const { data: history } = useEmitterHistory(emitter.id);
  const { latest, lastVersion, checkpointsSince } = latestSaves(history);
  const checkout = useCheckoutEmitter(emitter.id);
  const checkin = useCheckinEmitter(emitter.id);
  const commitVersion = useCommitEmitterVersion(emitter.id);
  const saveCheckpoint = useSaveCheckpoint(emitter.id);
  const [showCheckpointModal, setShowCheckpointModal] = useState(false);
  const [checkpointNote, setCheckpointNote] = useState("");
  const discard = useDiscardEmitterChanges(emitter.id);
  const { confirmDelete, dialog } = useConfirmDialog();
  const [error, setError] = useState<string | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [changeSummary, setChangeSummary] = useState("");

  const isAdmin = user?.role === "admin";
  // Anything saved, version or checkpoint — what unsaved changes count from, and Discard goes back to.
  const hasCommittedVersion = latest != null;
  const nextVersion = (lastVersion ? Number(lastVersion.ref) : 0) + 1;

  async function handleCheckout() {
    setError(null);
    try {
      await checkout.mutateAsync();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to start editing");
    }
  }

  function handleOpenSave() {
    setError(null);
    // The notes of the checkpoints it gathers up, as a start.
    setChangeSummary(
      checkpointsSince
        .map((c) => c.change_summary)
        .filter(Boolean)
        .join("; "),
    );
    setShowSaveModal(true);
  }

  async function handleSaveCheckpoint() {
    setError(null);
    try {
      await saveCheckpoint.mutateAsync(checkpointNote.trim() || undefined);
      setShowCheckpointModal(false);
      setCheckpointNote("");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to save a checkpoint");
    }
  }

  // Saving commits a real, named version (so it shows up in Version History
  // with a summary an editor can later revert to) and only then releases the
  // checkout.
  async function handleSaveAndCheckin() {
    if (!changeSummary.trim()) return;
    setError(null);
    try {
      await commitVersion.mutateAsync(changeSummary.trim());
      await checkin.mutateAsync();
      setShowSaveModal(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to save");
    }
  }

  async function handleForceRelease() {
    setError(null);
    try {
      await checkin.mutateAsync();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to release checkout");
    }
  }

  async function handleDiscard() {
    if (
      !(await confirmDelete(`Discard unsaved changes and go back to v${latest?.ref ?? ""}, the last save?`, {
        confirmLabel: "Discard",
        danger: true,
      }))
    )
      return;
    setError(null);
    try {
      await discard.mutateAsync();
      onDiscarded?.();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to discard changes");
    }
  }

  return (
    <RequireRole minimum="editor">
      {!isCheckedOut ? (
        <button className="button start-editing-button" disabled={checkout.isPending} onClick={() => void handleCheckout()}>
          <Icon name="edit" /> Start editing
        </button>
      ) : isMine ? (
        <>
          {hasCommittedVersion && onToggleChanges ? (
            <button
              type="button"
              className="editing-chip"
              onClick={onToggleChanges}
              aria-expanded={showingChanges}
              title={`${latest ? `Last saved as v${latest.ref}${latest.kind === "checkpoint" ? " (a checkpoint)" : ""}. ` : ""}Show or hide your unsaved changes`}
            >
              <Icon name="edit" /> Editing{latest?.kind === "checkpoint" ? ` · v${latest.ref}` : ""}
              <span className="editing-chip-part">Changes {showingChanges ? "▴" : "▾"}</span>
            </button>
          ) : (
            <span
              className="editing-chip"
              title={latest ? `Last saved as v${latest.ref}${latest.kind === "checkpoint" ? " (a checkpoint)" : ""}` : "Nothing saved yet"}
            >
              <Icon name="edit" /> Editing{latest?.kind === "checkpoint" ? ` · v${latest.ref}` : ""}
            </span>
          )}
          <button
            className="button danger-outline"
            disabled={discard.isPending || !hasCommittedVersion}
            title={!hasCommittedVersion ? "Nothing saved to go back to yet" : `Back to v${latest?.ref}, the last save`}
            onClick={() => void handleDiscard()}
          >
            Discard
          </button>
          <button
            className="button secondary"
            disabled={saveCheckpoint.isPending}
            title="Save your work so far as a checkpoint and keep editing — kept in the history, but not a version: nothing pins or tests it"
            onClick={() => {
              setError(null);
              setCheckpointNote("");
              setShowCheckpointModal(true);
            }}
          >
            Save checkpoint
          </button>
          <button
            className="button primary"
            disabled={checkin.isPending || commitVersion.isPending}
            title={`Save v${nextVersion} — the version Platforms can pin, exports use and tests count against — and stop editing`}
            onClick={handleOpenSave}
          >
            Save version
          </button>
        </>
      ) : (
        <>
          <span className="checkout-badge" title={checkedOutAt ? `Since ${formatDateTime(checkedOutAt)}` : undefined}>
            Being edited by {holderUsername ?? "another user"}
          </span>
          {isAdmin && (
            <button
              className="link-button"
              disabled={checkin.isPending}
              title="Releases the lock without saving a version — whatever the other editor had live stays live, unsaved. Use this to unstick an abandoned checkout."
              onClick={() => void handleForceRelease()}
            >
              Force release
            </button>
          )}
        </>
      )}
      {error && <span className="error-text">{error}</span>}
      {dialog}
      {showCheckpointModal && (
        <Modal title={`Save checkpoint v${lastVersion ? lastVersion.ref : 0}.${checkpointsSince.length + 1}`} onClose={() => setShowCheckpointModal(false)} wide>
          <p className="hint-text">
            A checkpoint saves your work so far and keeps you editing. It&apos;s kept in Version History — you can go back
            to it, or make it the next version — but it isn&apos;t a version: Platforms, exports and tests keep using v
            {lastVersion?.ref ?? "—"} until you save one.
          </p>
          <LiveDiffPanel emitterId={emitter.id} />
          <label>
            Note (optional)
            <textarea
              className="edit-input"
              rows={2}
              value={checkpointNote}
              onChange={(e) => setCheckpointNote(e.target.value)}
              placeholder="e.g. Track Modes in, Search still to do"
              autoFocus
            />
          </label>
          {error && <div className="error-text">{error}</div>}
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setShowCheckpointModal(false)} disabled={saveCheckpoint.isPending}>
              Cancel
            </button>
            <button className="button primary" onClick={() => void handleSaveCheckpoint()} disabled={saveCheckpoint.isPending}>
              {saveCheckpoint.isPending ? "Saving…" : "Save checkpoint"}
            </button>
          </div>
        </Modal>
      )}
      {showSaveModal && (
        <Modal title={`Save version ${nextVersion}`} onClose={() => setShowSaveModal(false)} wide>
          <p className="hint-text">
            Saving creates v{nextVersion}, a permanent version of this Emitter — the one Platforms can pin, exports use
            and tests count against. It shows up in Version History with your summary below, can be reverted to later,
            and ends your editing session.
            {checkpointsSince.length > 0 &&
              ` It takes in the ${checkpointsSince.length} checkpoint${checkpointsSince.length === 1 ? "" : "s"} since ${lastVersion ? `v${lastVersion.ref}` : "the start"}.`}
          </p>
          {lastVersion ? <ChangesSince emitterId={emitter.id} from={lastVersion.ref} /> : <LiveDiffPanel emitterId={emitter.id} />}
          <label>
            What changed? (required)
            <textarea
              className="edit-input"
              rows={3}
              value={changeSummary}
              onChange={(e) => setChangeSummary(e.target.value)}
              placeholder="e.g. Added Track Mode 2, widened RF range on Mode 1 per updated ELINT report"
              autoFocus
            />
          </label>
          {error && <div className="error-text">{error}</div>}
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setShowSaveModal(false)}
              disabled={commitVersion.isPending || checkin.isPending}
            >
              Cancel
            </button>
            <button
              className="button primary"
              onClick={() => void handleSaveAndCheckin()}
              disabled={commitVersion.isPending || checkin.isPending || !changeSummary.trim()}
            >
              {commitVersion.isPending || checkin.isPending ? "Saving…" : "Save version"}
            </button>
          </div>
        </Modal>
      )}
    </RequireRole>
  );
}

/** What changed from a save to the Emitter as it is now. */
function ChangesSince({ emitterId, from }: { emitterId: string; from: string }) {
  const { data: diff, isLoading } = useEmitterHistoryDiff(emitterId, from, "live");
  return (
    <div className="live-diff-panel">
      <p className="hint-text">Changes since v{from}:</p>
      {isLoading ? <p className="hint-text">Loading changes…</p> : diff && <EmitterDiffViewer diff={diff} />}
    </div>
  );
}

export function LiveDiffPanel({ emitterId }: { emitterId: string }) {
  const { data: diff, isLoading } = useEmitterLiveDiff(emitterId);
  return (
    <div className="live-diff-panel">
      {isLoading ? (
        <p className="hint-text">Loading changes…</p>
      ) : diff ? (
        <EmitterDiffViewer diff={diff} />
      ) : (
        <p className="hint-text">No saved version to compare against yet.</p>
      )}
    </div>
  );
}
