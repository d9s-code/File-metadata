import { useState, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import { ApiRequestError } from "../../api/client";
import { useRejectSource } from "../../state/hooks/useSources";
import type { Source } from "../../types/domain";

export function RejectSourceModal({
  emitterId,
  source,
  onClose,
}: {
  emitterId: string;
  source: Source;
  onClose: () => void;
}) {
  const rejectSource = useRejectSource(emitterId);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await rejectSource.mutateAsync({ sourceId: source.id, reason: reason.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to reject Source");
    }
  }

  return (
    <Modal title={`Reject "${source.name}"`} onClose={onClose} wide>
      <form onSubmit={handleSubmit}>
        <p className="hint-text">
          A rejected Source stays in the list, flagged with this reason, and its Modes are left out of exports and
          ambiguity checks. It can still be approved later.
        </p>
        <label className="wide-label">
          Reason for rejecting
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={2000}
            required
            autoFocus
          />
        </label>
        <div className="form-row">
          <button
            type="submit"
            className="danger-button"
            disabled={rejectSource.isPending || !reason.trim()}
          >
            {rejectSource.isPending ? "Rejecting…" : "Reject Source"}
          </button>
          <button type="button" className="button" onClick={onClose} disabled={rejectSource.isPending}>
            Cancel
          </button>
        </div>
        {error && <div className="error-text">{error}</div>}
      </form>
    </Modal>
  );
}
