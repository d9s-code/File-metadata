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
import { useEmitterLiveDiff, useEmitterVersions } from "../../state/hooks/useEmitterVersions";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { ApiRequestError } from "../../api/client";
import { EmitterDiffViewer } from "./EmitterDiffViewer";

export function CheckoutBanner({ emitter }: { emitter: Emitter }) {
  const { user } = useAuth();
  const { isCheckedOut, isMine, holderUsername, checkedOutAt } = useEmitterCheckoutState(emitter);
  const { data: versions } = useEmitterVersions(emitter.id);
  const checkout = useCheckoutEmitter(emitter.id);
  const checkin = useCheckinEmitter(emitter.id);
  const discard = useDiscardEmitterChanges(emitter.id);
  const { confirmDelete, dialog } = useConfirmDialog();
  const [error, setError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);

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

  async function handleCheckin() {
    setError(null);
    try {
      await checkin.mutateAsync();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to save");
    }
  }

  async function handleDiscard() {
    if (!(await confirmDelete("Discard uncommitted changes and revert to the latest committed version?"))) return;
    setError(null);
    try {
      await discard.mutateAsync();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to discard changes");
    }
  }

  return (
    <RequireRole minimum="editor">
    <div className="checkout-banner-wrap">
    <div className="checkout-banner">
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
            className="link-button"
            disabled={discard.isPending || !hasCommittedVersion}
            title={!hasCommittedVersion ? "No committed version to discard back to yet" : undefined}
            onClick={() => void handleDiscard()}
          >
            Discard changes
          </button>
          <button className="link-button" disabled={checkin.isPending} onClick={() => void handleCheckin()}>
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
            <button className="link-button" disabled={checkin.isPending} onClick={() => void handleCheckin()}>
              Force release
            </button>
          )}
        </>
      )}
      {hasCommittedVersion && (
        <button className="link-button" onClick={() => setShowDiff((v) => !v)}>
          {showDiff ? "Hide changes" : "View changes since last commit"}
        </button>
      )}
      {error && <span className="error-text">{error}</span>}
      {dialog}
    </div>
    {showDiff && <LiveDiffPanel emitterId={emitter.id} />}
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
