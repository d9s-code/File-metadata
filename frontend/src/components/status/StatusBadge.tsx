import type { StatusEntityType } from "../../api/statuses";
import { useStatuses } from "../../state/hooks/useStatuses";

/** A status as a coloured badge, named and coloured as Admins set it up. */
export function StatusBadge({
  type,
  status,
  title,
}: {
  type: StatusEntityType;
  status: string | null | undefined;
  title?: string;
}) {
  const s = useStatuses(type);
  if (!status) return null;
  return (
    <span className={`status-badge status-color-${s.color(status)}`} title={title}>
      {s.label(status)}
    </span>
  );
}
