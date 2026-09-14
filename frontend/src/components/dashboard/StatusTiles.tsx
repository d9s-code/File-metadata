export function StatusTiles({
  counts,
  labelFor = (status) => status.replace("_", " "),
}: {
  counts: Record<string, number>;
  labelFor?: (status: string) => string;
}) {
  return (
    <div className="status-tile-row">
      {Object.entries(counts).map(([status, count]) => (
        <div key={status} className="status-tile">
          <span className="status-tile-count">{count}</span>
          <span className={`status-badge status-${status}`}>{labelFor(status)}</span>
        </div>
      ))}
    </div>
  );
}
