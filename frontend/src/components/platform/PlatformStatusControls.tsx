import { useTransitionPlatformStatus } from "../../state/hooks/usePlatforms";
import { StatusControls } from "../status/StatusControls";

/** Moving the Platform along its lifecycle. With a saved version, the move
 * is saved as a new version with only the status changed. */
export function PlatformStatusControls({ platformId, status }: { platformId: string; status: string }) {
  const transition = useTransitionPlatformStatus(platformId);
  return (
    <StatusControls
      type="platform"
      itemId={platformId}
      status={status}
      move={async (newStatus, note, confirmUnmet) => {
        await transition.mutateAsync({ newStatus, note, confirmUnmet });
      }}
    />
  );
}
