import { statusLabel } from "../common/emitterStatusLabel";

/** How many sit at each stage, compactly: one line each, zeros faded back. */
export function StatusTiles({
  counts,
  labelFor = statusLabel,
  colorFor,
}: {
  counts: Record<string, number>;
  labelFor?: (status: string) => string;
  /** The status's colour (see Admin → Statuses); without it, by the stored key. */
  colorFor?: (status: string) => string;
}) {
  return (
    <ul className="status-compact">
      {Object.entries(counts).map(([status, count]) => (
        <li key={status} className={count === 0 ? "zero" : undefined}>
          <span className="status-compact-count">{count}</span>
          <span className={`status-badge ${colorFor ? `status-color-${colorFor(status)}` : `status-${status}`}`}>
            {labelFor(status)}
          </span>
        </li>
      ))}
    </ul>
  );
}
