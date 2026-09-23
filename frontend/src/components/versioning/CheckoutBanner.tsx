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

export function CheckoutBanner({ emitter, onDiscarded }: { emitter: Emitter; onDiscarded?: () => void }) {
  const { user } = useAuth();
  const { isCheckedOut, isMine, holderUsername, checkedOutAt } = useEmitterCheckoutState(emitter);
  const { data: versions } = useEmitterVersions(emitter.id);
  const checkout = useCheckoutEmitter(emitter.id);
  const checkin = useCheckinEmitter(emitter.id);
  const commitVersion = useCommitEmitterVersion(emitter.id);
  const discard = useDiscardEmitterChanges(emitter.id);
  const { confirmDelete, dialog } = useConfirmDialog();
  const [error, setError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
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

  // "Save" commits a real, named version (so it shows up in Version History
  // with a summary an editor can later revert to) and only then releases the
  // checkout — a bare check-in used to release the lock with no durable
  // record of what changed and no way to roll back to that point.
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
    if (!(await confirmDelete("Discard uncommitted changes and revert to the latest committed version?"))) return;
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
    <div className="checkout-banner-wrap">
    <div className={isMine ? "checkout-banner checkout-banner-editing" : "checkout-banner"}>
      {!isCheckedOut ? (
        <>
          <span className="hint-text">Not currently being edited.</span>
          <button className="icon-button" disabled={checkout.isPending} onClick={() => void handleCheckout()}>
            Start Editing
          </button>
        </>
      ) : isMine ? (
        <>
          <span className="checkout-badge checkout-badge-mine">You&rsquo;re editing this Emitter</span>
          <button
            className="link-button link-button-danger"
            disabled={discard.isPending || !hasCommittedVersion}
            title={!hasCommittedVersion ? "No committed version to discard back to yet" : undefined}
            onClick={() => void handleDiscard()}
          >
            Discard changes
          </button>
          <button className="link-button" disabled={checkin.isPending || commitVersion.isPending} onClick={handleOpenSave}>
            Save
          </button>
        </>
      ) : (
        <>
          <span className="checkout-badge">
            Checked out by {holderUsername ?? "another user"}
            {checkedOutAt ? ` since ${new Date(checkedOutAt).toLocaleString()}` : ""}
          </span>
          {isAdmin && (
            <button
              className="link-button"
              disabled={checkin.isPending}
              title="Releases the lock without committing a version — whatever the other editor had live stays live, uncommitted. Use this to unstick an abandoned checkout, not as a substitute for Save."
              onClick={() => void handleForceRelease()}
            >
              Force release
            </button>
          )}
        </>
      )}
      {isMine && hasCommittedVersion && (
        <button className="link-button" onClick={() => setShowDiff((v) => !v)}>
          {showDiff ? "Hide changes" : "View changes since last save"}
        </button>
      )}
      {error && <span className="error-text">{error}</span>}
      {dialog}
    </div>
    {isMine && showDiff && <LiveDiffPanel emitterId={emitter.id} />}
    {showSaveModal && (
      <Modal title="Save — commit a version" onClose={() => setShowSaveModal(false)} wide>
        <p className="hint-text">
          Saving commits a new, permanent version of this Emitter — it shows up in Version History with your
          summary below and can be reverted to later. This is what makes your changes recoverable.
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
            {commitVersion.isPending || checkin.isPending ? "Saving…" : "Save"}
          </button>
          <button className="button" onClick={() => setShowSaveModal(false)} disabled={commitVersion.isPending || checkin.isPending}>
            Cancel
          </button>
        </div>
        {error && <div className="error-text">{error}</div>}
      </Modal>
    )}
    </div>
    </RequireRole>
  );
}

function LiveDiffPanel({ emitterId }: { emitterId: string }) {
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
