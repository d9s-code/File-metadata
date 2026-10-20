import { useTransitionPlatformStatus } from "../../state/hooks/usePlatforms";
import { StatusControls } from "../status/StatusControls";

/** Moving the Platform along its lifecycle — where it stands, not part of
 * its content, so no version is saved for it. */
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
