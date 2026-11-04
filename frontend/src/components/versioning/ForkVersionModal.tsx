import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "../common/Modal";
import { useForkEmitterVersion } from "../../state/hooks/useEmitterVersions";
import { ApiRequestError } from "../../api/client";

export function ForkVersionModal({
  emitterId,
  versionNumber,
  onClose,
}: {
  emitterId: string;
  versionNumber: number;
  onClose: () => void;
}) {
  const fork = useForkEmitterVersion(emitterId);
  const navigate = useNavigate();
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const forked = await fork.mutateAsync({ versionNumber, newName });
      navigate(`/emitters/${forked.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't copy this version");
    }
  }

  return (
    <Modal title={`Copy v${versionNumber} as a new Emitter`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <p className="hint-text">
          Makes a new Emitter that starts out as this version — a separate copy, so editing it never affects the
          original. Its history up to this version comes along (to look at and compare), with the copy recorded as
          its next version.
        </p>
        <div className="form-row">
          <input
            placeholder="New Emitter name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
            required
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={fork.isPending}>
            Make the copy
          </button>
        </div>
        {error && <div className="error-text">{error}</div>}
      </form>
    </Modal>
  );
}
