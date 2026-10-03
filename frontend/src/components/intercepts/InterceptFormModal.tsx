import { useState, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import { ApiRequestError } from "../../api/client";
import { useCreateIntercept, useUpdateIntercept } from "../../state/hooks/useIntercepts";
import type { Emitter, Intercept } from "../../types/domain";

/** Add an Intercept, or edit one's details. Pass `emitterId` when the
 * Emitter is already known, or `emitters` to let the user pick one. */
export function InterceptFormModal({
  intercept,
  emitterId,
  emitters,
  onClose,
  onSaved,
}: {
  intercept?: Intercept;
  emitterId?: string;
  emitters?: Emitter[];
  onClose: () => void;
  onSaved?: (intercept: Intercept) => void;
}) {
  const createIntercept = useCreateIntercept();
  const updateIntercept = useUpdateIntercept();
  const [name, setName] = useState(intercept?.name ?? "");
  const [interceptedOn, setInterceptedOn] = useState(intercept?.intercepted_on ?? "");
  const [collectedBy, setCollectedBy] = useState(intercept?.collected_by ?? "");
  const [description, setDescription] = useState(intercept?.description ?? "");
  const [pickedEmitterId, setPickedEmitterId] = useState(emitterId ?? "");
  const [error, setError] = useState<string | null>(null);
  const pending = createIntercept.isPending || updateIntercept.isPending;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const fields = {
      name: name.trim(),
      intercepted_on: interceptedOn || null,
      collected_by: collectedBy.trim() || null,
      description: description.trim() || null,
    };
    try {
      const saved = intercept
        ? await updateIntercept.mutateAsync({ interceptId: intercept.id, input: fields })
        : await createIntercept.mutateAsync({ emitter_id: pickedEmitterId, ...fields });
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to save Intercept");
    }
  }

  return (
    <Modal title={intercept ? "Edit details" : "Add Intercept"} onClose={onClose}>
      <form className="edit-fields" onSubmit={handleSubmit}>
        {!intercept && !emitterId && (
          <label>
            Emitter
            <select value={pickedEmitterId} onChange={(e) => setPickedEmitterId(e.target.value)} required>
              <option value="" disabled>
                Select an Emitter…
              </option>
              {(emitters ?? []).map((em) => (
                <option key={em.id} value={em.id}>
                  {em.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Name
          <input
            className="edit-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Baltic sortie 14 Aug"
            required
            autoFocus
          />
        </label>
        <div className="form-row">
          <label>
            Recorded on
            <input type="date" className="edit-input" value={interceptedOn} onChange={(e) => setInterceptedOn(e.target.value)} />
          </label>
          <label className="grow">
            Collected by
            <input
              className="edit-input"
              value={collectedBy}
              onChange={(e) => setCollectedBy(e.target.value)}
              placeholder="Platform, sensor or site — e.g. P-8A / ESM suite"
              maxLength={200}
            />
          </label>
        </div>
        <label>
          Description
          <textarea className="edit-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={pending || !name.trim() || (!intercept && !pickedEmitterId)}>
            {pending ? "Saving…" : intercept ? "Save" : "Add Intercept"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
