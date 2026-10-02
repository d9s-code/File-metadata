import { useState } from "react";
import type { Emitter } from "../../types/domain";
import { useAuth } from "../../auth/AuthContext";
import { RequireRole } from "../../auth/RequireAuth";
import {
  useCheckinEmitter,
  useCheckoutEmitter,
  useDiscardEmitterChanges,
  useEmitterCheckoutState,
} from "../../state/hooks/useEmitterCheckout";
import { useCommitEmitterVersion, useEmitterLiveDiff, useEmitterVersions } from "../../state/hooks/useEmitterVersions";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { ApiRequestError } from "../../api/client";
import { EmitterDiffViewer } from "./EmitterDiffViewer";
import { Modal } from "../common/Modal";

/** The Emitter's edit-mode controls, for the page header: Start editing
 * when nobody holds the checkout; Save version / Discard (and a link to the
 * changes so far) while you do; who holds it otherwise. */
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
  const { data: versions } = useEmitterVersions(emitter.id);
  const checkout = useCheckoutEmitter(emitter.id);
  const checkin = useCheckinEmitter(emitter.id);
  const commitVersion = useCommitEmitterVersion(emitter.id);
  const discard = useDiscardEmitterChanges(emitter.id);
  const { confirmDelete, dialog } = useConfirmDialog();
  const [error, setError] = useState<string | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [changeSummary, setChangeSummary] = useState("");

  const isAdmin = user?.role === "admin";
  const hasCommittedVersion = (versions?.length ?? 0) > 0;

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
    setChangeSummary("");
    setShowSaveModal(true);
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
      !(await confirmDelete("Discard unsaved changes and go back to the last saved version?", {
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
        <button className="button primary" disabled={checkout.isPending} onClick={() => void handleCheckout()}>
          Start editing
        </button>
      ) : isMine ? (
        <>
          <span className="checkout-badge checkout-badge-mine">✎ Editing</span>
          {hasCommittedVersion && onToggleChanges && (
            <button type="button" className="link-button" onClick={onToggleChanges} aria-expanded={showingChanges}>
              {showingChanges ? "Hide changes" : "Changes"}
            </button>
          )}
          <button
            className="button danger-outline"
            disabled={discard.isPending || !hasCommittedVersion}
            title={!hasCommittedVersion ? "No saved version to go back to yet" : undefined}
            onClick={() => void handleDiscard()}
          >
            Discard
          </button>
          <button className="button primary" disabled={checkin.isPending || commitVersion.isPending} onClick={handleOpenSave}>
            Save version
          </button>
        </>
      ) : (
        <>
          <span className="checkout-badge" title={checkedOutAt ? `Since ${new Date(checkedOutAt).toLocaleString()}` : undefined}>
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
      {showSaveModal && (
        <Modal title="Save version" onClose={() => setShowSaveModal(false)} wide>
          <p className="hint-text">
            Saving creates a new, permanent version of this Emitter — it shows up in Version History with your
            summary below and can be reverted to later — and ends your editing session.
          </p>
          <LiveDiffPanel emitterId={emitter.id} />
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
          <div className="edit-actions">
            <button
              className="button primary"
              onClick={() => void handleSaveAndCheckin()}
              disabled={commitVersion.isPending || checkin.isPending || !changeSummary.trim()}
            >
              {commitVersion.isPending || checkin.isPending ? "Saving…" : "Save version"}
            </button>
            <button className="button" onClick={() => setShowSaveModal(false)} disabled={commitVersion.isPending || checkin.isPending}>
              Cancel
            </button>
          </div>
          {error && <div className="error-text">{error}</div>}
        </Modal>
      )}
    </RequireRole>
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
        <p className="hint-text">No committed version to compare against yet.</p>
      )}
    </div>
  );
}
