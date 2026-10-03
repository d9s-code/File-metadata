import { useState } from "react";
import { useMdfReadiness, useTransitionMdfStatus } from "../../state/hooks/useMdfs";
import { ApiRequestError } from "../../api/client";
import type { MdfStatus } from "../../types/domain";
import { RequireRole } from "../../auth/RequireAuth";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { statusLabel } from "../common/emitterStatusLabel";

const MDF_TRANSITIONS: Record<MdfStatus, MdfStatus[]> = {
  draft: ["pending_review"],
  pending_review: ["approved", "draft"],
  approved: ["released", "pending_review"],
  released: ["deprecated"],
  deprecated: ["draft"],
};

export function MdfStatusTransitionControls({ mdfId, status }: { mdfId: string; status: MdfStatus }) {
  const { data: readiness } = useMdfReadiness(mdfId);
  const transition = useTransitionMdfStatus(mdfId);
  const [error, setError] = useState<string | null>(null);
  const { confirmDelete: confirm, dialog } = useConfirmDialog();

  async function handleTransition(newStatus: MdfStatus) {
    setError(null);
    if (readiness && readiness.warnings.length > 0) {
      const message = `This MDF has open readiness warnings:\n\n${readiness.warnings.join("\n")}\n\nMove it to ${statusLabel(newStatus)} anyway?`;
      if (!(await confirm(message, { confirmLabel: `Move to ${statusLabel(newStatus)}` }))) return;
    }
    try {
      await transition.mutateAsync({ newStatus });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Status transition failed");
    }
  }

  return (
    <RequireRole minimum="editor">
      <div className="status-controls">
        {MDF_TRANSITIONS[status].map((next) => (
          <button
            key={next}
            className="status-transition-button"
            onClick={() => void handleTransition(next)}
            disabled={transition.isPending}
          >
            Move to {statusLabel(next)}
          </button>
        ))}
        {error && <span className="error-text">{error}</span>}
      </div>
      {dialog}
    </RequireRole>
  );
}
