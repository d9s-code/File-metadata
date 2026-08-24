import { useState } from "react";
import { useTransitionEmitterStatus } from "../../state/hooks/useEmitterVersions";
import { ApiRequestError } from "../../api/client";
import type { EmitterStatus } from "../../types/domain";
import { RequireRole } from "../../auth/RequireAuth";

const EMITTER_TRANSITIONS: Record<EmitterStatus, EmitterStatus[]> = {
  draft: ["in_review"],
  in_review: ["validated", "draft"],
  validated: ["deprecated", "in_review"],
  deprecated: ["draft"],
};

export function StatusTransitionControls({ emitterId, status }: { emitterId: string; status: EmitterStatus }) {
  const transition = useTransitionEmitterStatus(emitterId);
  const [error, setError] = useState<string | null>(null);

  async function handleTransition(newStatus: EmitterStatus) {
    setError(null);
    try {
      await transition.mutateAsync({ newStatus });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Status transition failed");
    }
  }

  return (
    <RequireRole minimum="editor">
      <div className="status-controls">
        {EMITTER_TRANSITIONS[status].map((next) => (
          <button key={next} className="status-transition-button" onClick={() => void handleTransition(next)} disabled={transition.isPending}>
            Move to {next.replace("_", " ")}
          </button>
        ))}
        {error && <span className="error-text">{error}</span>}
      </div>
    </RequireRole>
  );
}
