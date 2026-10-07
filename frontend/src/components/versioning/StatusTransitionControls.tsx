import { useState } from "react";
import { useTransitionEmitterStatus } from "../../state/hooks/useEmitterVersions";
import { ApiRequestError } from "../../api/client";
import type { EmitterStatus } from "../../types/domain";
import { emitterStatusLabel } from "../common/emitterStatusLabel";
import { RequireRole } from "../../auth/RequireAuth";
import { useEmitterVersions } from "../../state/hooks/useEmitterVersions";

const EMITTER_TRANSITIONS: Record<EmitterStatus, EmitterStatus[]> = {
  draft: ["in_review"],
  in_review: ["validated", "draft"],
  validated: ["deprecated", "in_review"],
  deprecated: ["draft"],
};

// Two cases require a message, both here and (authoritatively) server-side:
// flagging previously-Operational data as needing rework is a claim that
// something concrete broke, and declaring something Operational is the one
// status change everything downstream (Platforms/MDFs pinning this Emitter)
// treats as a trust signal — both deserve a documented reason.
function requiresNote(status: EmitterStatus, next: EmitterStatus): boolean {
  return (status === "validated" && next === "deprecated") || next === "validated";
}

function noteLabel(next: EmitterStatus): string {
  return next === "validated" ? "What was validated? (required)" : "What needs rework? (required)";
}

/** Moving the Emitter along its lifecycle. No Start editing needed: the
 * status describes the saved Emitter, so the change is saved as a new
 * version of the last saved one — anything being edited stays unsaved. */
export function StatusTransitionControls({ emitterId, status }: { emitterId: string; status: EmitterStatus }) {
  const transition = useTransitionEmitterStatus(emitterId);
  const { data: versions } = useEmitterVersions(emitterId);
  const hasVersion = (versions?.length ?? 0) > 0;
  const blocked = versions !== undefined && !hasVersion;
  const blockedTitle = blocked ? "Save a version first — a status describes a saved version" : undefined;
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pendingNext, setPendingNext] = useState<EmitterStatus | null>(null);
  const [note, setNote] = useState("");

  async function handleTransition(newStatus: EmitterStatus, noteText?: string) {
    setError(null);
    setDone(null);
    try {
      const version = await transition.mutateAsync({ newStatus, note: noteText || undefined });
      setPendingNext(null);
      setNote("");
      setDone(`Moved to ${emitterStatusLabel(newStatus)} — saved as version ${version.version_number}.`);
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
            disabled={transition.isPending || blocked}
            title={blockedTitle}
          >
            Move to {emitterStatusLabel(next)}
          </button>
        ))}
        {error && <span className="error-text">{error}</span>}
        {done && !error && (
          <span className="hint-text status-done" role="status">
            {done}
          </span>
        )}
      </div>
      {pendingNext && (
        <div className="status-note-form">
          <label>
            {noteLabel(pendingNext)}
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
              className="button secondary"
              onClick={() => {
                setPendingNext(null);
                setNote("");
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!note.trim() || transition.isPending || blocked}
              title={blockedTitle}
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
