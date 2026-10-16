import { useMdfReadiness, useTransitionMdfStatus } from "../../state/hooks/useMdfs";
import { StatusControls } from "../status/StatusControls";

/** Moving the MDF along its lifecycle — open readiness warnings are shown
 * first, to confirm. */
export function MdfStatusTransitionControls({ mdfId, status }: { mdfId: string; status: string }) {
  const { data: readiness } = useMdfReadiness(mdfId);
  const transition = useTransitionMdfStatus(mdfId);
  return (
    <StatusControls
      type="mdf"
      itemId={mdfId}
      status={status}
      beforeMove={async (_next, label, confirm) => {
        if (!readiness || readiness.warnings.length === 0) return true;
        return confirm(
          `This MDF has open readiness warnings:\n\n${readiness.warnings.join("\n")}\n\nMove it to ${label} anyway?`,
          { confirmLabel: `Move to ${label}` },
        );
      }}
      move={async (newStatus, note, confirmUnmet) => {
        await transition.mutateAsync({ newStatus, note, confirmUnmet });
      }}
    />
  );
}
