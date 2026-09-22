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
      setError(err instanceof ApiRequestError ? err.message : "Failed to fork this version");
    }
  }

  return (
    <Modal title={`Fork version ${versionNumber}`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <p className="hint-text">
          Creates a brand-new, fully independent Emitter seeded from this version — editing it never affects the
          original. Its version history up to this point comes along too (viewable and diffable), with the fork
          itself recorded as the next entry.
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
          <button type="button" className="icon-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={fork.isPending}>
            Fork
          </button>
        </div>
        {error && <div className="error-text">{error}</div>}
      </form>
    </Modal>
  );
}
