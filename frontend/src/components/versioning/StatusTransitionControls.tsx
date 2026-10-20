import { useTransitionEmitterStatus } from "../../state/hooks/useEmitterVersions";
import { useStatuses } from "../../state/hooks/useStatuses";
import { StatusControls } from "../status/StatusControls";

/** Moving the Emitter along its lifecycle. No Start editing needed: status
 * is where the Emitter stands, not part of its content — no version is saved
 * for it, and anything being edited stays as it is. */
export function StatusTransitionControls({ emitterId, status }: { emitterId: string; status: string }) {
  const transition = useTransitionEmitterStatus(emitterId);
  const statuses = useStatuses("emitter");
  return (
    <StatusControls
      type="emitter"
      itemId={emitterId}
      status={status}
      move={async (newStatus, note, confirmUnmet) => {
        await transition.mutateAsync({ newStatus, note, confirmUnmet });
        return `Moved to ${statuses.label(newStatus)}.`;
      }}
    />
  );
}
