import { useEmitterVersions, useTransitionEmitterStatus } from "../../state/hooks/useEmitterVersions";
import { useStatuses } from "../../state/hooks/useStatuses";
import { StatusControls } from "../status/StatusControls";

/** Moving the Emitter along its lifecycle. No Start editing needed: the
 * status describes the saved Emitter, so the change is saved as a new
 * version of the last saved one — anything being edited stays unsaved. */
export function StatusTransitionControls({ emitterId, status }: { emitterId: string; status: string }) {
  const transition = useTransitionEmitterStatus(emitterId);
  const { data: versions } = useEmitterVersions(emitterId);
  const statuses = useStatuses("emitter");
  const blocked = versions !== undefined && versions.length === 0;
  return (
    <StatusControls
      type="emitter"
      itemId={emitterId}
      status={status}
      disabledTitle={blocked ? "Save a version first — a status describes a saved version" : undefined}
      move={async (newStatus, note, confirmUnmet) => {
        const version = await transition.mutateAsync({ newStatus, note, confirmUnmet });
        return `Moved to ${statuses.label(newStatus)} — saved as version ${version.version_number}.`;
      }}
    />
  );
}
