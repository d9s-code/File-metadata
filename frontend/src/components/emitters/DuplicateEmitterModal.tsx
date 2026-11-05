import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiRequestError } from "../../api/client";
import { useDuplicateEmitter } from "../../state/hooks/useEmitterVersions";
import { Modal } from "../common/Modal";

/** "Duplicate…": a new Emitter copied from this one as it stands now. */
export function DuplicateEmitterModal({
  emitterId,
  emitterName,
  onClose,
}: {
  emitterId: string;
  emitterName: string;
  onClose: () => void;
}) {
  const duplicate = useDuplicateEmitter(emitterId);
  const navigate = useNavigate();
  const [name, setName] = useState(`${emitterName} (copy)`);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give the copy a name.");
    setError(null);
    try {
      const copy = await duplicate.mutateAsync(name.trim());
      navigate(`/emitters/${copy.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't duplicate it.");
    }
  }

  return (
    <Modal title="Duplicate Emitter" onClose={onClose}>
      <form className="rename-form" onSubmit={submit}>
        <p className="hint-text">
          A new Emitter with everything {emitterName} has now — Groups, Sources, Elements, Modes and test lines, changes
          not saved yet included. It starts as a Draft, checked out to you, saved as its v1. Test history, files and
          comments stay with the original, and nothing pins the copy. To copy an older saved version instead, fork it
          from Version history.
        </p>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus />
        </label>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={duplicate.isPending}>
            {duplicate.isPending ? "Duplicating…" : "Duplicate"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
