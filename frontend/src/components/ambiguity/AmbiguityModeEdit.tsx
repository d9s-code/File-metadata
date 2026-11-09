import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiRequestError } from "../../api/client";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useCheckoutEmitter, useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";
import { useEmitterModes } from "../../state/hooks/useModes";
import { useSources } from "../../state/hooks/useSources";
import { Modal } from "../common/Modal";
import { ModeEditDialog } from "../modes/ModeDialogs";
import type { LineValues } from "../modes/modeLine";

/** Editing a Mode from the ambiguity check, on the page: the Mode's own edit
 * window — started with a suggested change, if one was picked. When nobody is
 * editing its Emitter it offers to start; when someone else is, it says who. */
export function AmbiguityModeEdit({
  emitterId,
  modeId,
  modeName,
  lineChange,
  onClose,
}: {
  emitterId: string;
  modeId: string;
  modeName: string;
  lineChange?: Partial<LineValues>;
  onClose: () => void;
}) {
  const { data: emitter } = useEmitter(emitterId);
  const { data: modes, isLoading } = useEmitterModes(emitterId);
  const { data: sources } = useSources(emitterId);
  const { isCheckedOut, isMine, holderUsername } = useEmitterCheckoutState(emitter);
  const checkout = useCheckoutEmitter(emitterId);
  const [error, setError] = useState<string | null>(null);
  const mode = modes?.find((m) => m.id === modeId);

  if (!emitter || isLoading) {
    return (
      <Modal title={`Edit ${modeName}`} onClose={onClose}>
        <p className="hint-text">Loading…</p>
      </Modal>
    );
  }
  if (!mode) {
    return (
      <Modal title={`Edit ${modeName}`} onClose={onClose}>
        <p>
          {modeName} isn&apos;t in {emitter.name} any more — it was deleted or merged since this check. Save a version of{" "}
          {emitter.name} and run the check again.
        </p>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </Modal>
    );
  }
  if (isMine) {
    return <ModeEditDialog emitterId={emitterId} mode={mode} sources={sources ?? []} lineChange={lineChange} onClose={onClose} />;
  }
  return (
    <Modal title={`Edit ${modeName}`} onClose={onClose}>
      {isCheckedOut ? (
        <p>
          {holderUsername ?? "Someone else"} is editing <strong>{emitter.name}</strong>, so its Modes can&apos;t be changed
          until they save or discard. <Link to={`/emitters/${emitterId}`}>Open {emitter.name}</Link>
        </p>
      ) : (
        <p>
          To change <strong>{modeName}</strong>, start editing <strong>{emitter.name}</strong>. Others can&apos;t edit it
          until you save a version or discard — both can be done from this page.
        </p>
      )}
      {error && <p className="error-text">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={onClose}>
          Cancel
        </button>
        {!isCheckedOut && (
          <button
            type="button"
            disabled={checkout.isPending}
            onClick={async () => {
              setError(null);
              try {
                await checkout.mutateAsync();
              } catch (err) {
                setError(err instanceof ApiRequestError ? err.message : "Couldn't start editing");
              }
            }}
          >
            {checkout.isPending ? "Starting…" : `Start editing ${emitter.name}`}
          </button>
        )}
      </div>
    </Modal>
  );
}
