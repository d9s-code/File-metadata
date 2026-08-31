import { useState } from "react";
import { useTransitionEmitterStatus } from "../../state/hooks/useEmitterVersions";
import { ApiRequestError } from "../../api/client";
import type { EmitterStatus } from "../../types/domain";
import { emitterStatusLabel } from "../common/emitterStatusLabel";
import { RequireRole } from "../../auth/RequireAuth";

const EMITTER_TRANSITIONS: Record<EmitterStatus, EmitterStatus[]> = {
  draft: ["in_review"],
  in_review: ["validated", "draft"],
  validated: ["deprecated", "in_review"],
  deprecated: ["draft"],
};

// Flagging previously-Operational data as needing rework is a claim that
// something concrete broke — require the note explaining what, both here
// and (authoritatively) server-side, so it's traceable later.
function requiresNote(status: EmitterStatus, next: EmitterStatus): boolean {
  return status === "validated" && next === "deprecated";
}

export function StatusTransitionControls({ emitterId, status }: { emitterId: string; status: EmitterStatus }) {
  const transition = useTransitionEmitterStatus(emitterId);
  const [error, setError] = useState<string | null>(null);
  const [pendingNext, setPendingNext] = useState<EmitterStatus | null>(null);
  const [note, setNote] = useState("");

  async function handleTransition(newStatus: EmitterStatus, noteText?: string) {
    setError(null);
    try {
      await transition.mutateAsync({ newStatus, note: noteText || undefined });
      setPendingNext(null);
      setNote("");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Status transition failed");
    }
  }

  function handleClick(next: EmitterStatus) {
    if (requiresNote(status, next)) {
      setError(null);
      setPendingNext(next);
    } else {
      void handleTransition(next);
    }
  }

  return (
    <RequireRole minimum="editor">
      <div className="status-controls">
        {EMITTER_TRANSITIONS[status].map((next) => (
          <button
            key={next}
            className="status-transition-button"
            onClick={() => handleClick(next)}
            disabled={transition.isPending}
          >
            Move to {emitterStatusLabel(next)}
          </button>
        ))}
        {error && <span className="error-text">{error}</span>}
      </div>
      {pendingNext && (
        <div className="status-note-form">
          <label>
            What needs rework? (required)
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              autoFocus
            />
          </label>
          <div className="modal-actions">
            <button
              type="button"
              className="icon-button"
              onClick={() => {
                setPendingNext(null);
                setNote("");
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!note.trim() || transition.isPending}
              onClick={() => void handleTransition(pendingNext, note.trim())}
            >
              Confirm
            </button>
          </div>
        </div>
      )}
    </RequireRole>
  );
}
