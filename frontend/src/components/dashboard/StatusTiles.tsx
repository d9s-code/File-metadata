import { statusLabel } from "../common/emitterStatusLabel";

/** How many sit at each stage, compactly: one line each, zeros faded back. */
export function StatusTiles({
  counts,
  labelFor = statusLabel,
}: {
  counts: Record<string, number>;
  labelFor?: (status: string) => string;
}) {
  return (
    <ul className="status-compact">
      {Object.entries(counts).map(([status, count]) => (
        <li key={status} className={count === 0 ? "zero" : undefined}>
          <span className="status-compact-count">{count}</span>
          <span className={`status-badge status-${status}`}>{labelFor(status)}</span>
        </li>
      ))}
    </ul>
  );
}
