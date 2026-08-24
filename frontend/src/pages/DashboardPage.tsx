import { useDashboard } from "../state/hooks/useDashboard";

function StatusTiles({ title, counts }: { title: string; counts: Record<string, number> }) {
  return (
    <div className="card status-tiles">
      <h4>{title}</h4>
      <div className="status-tile-row">
        {Object.entries(counts).map(([status, count]) => (
          <div key={status} className="status-tile">
            <span className="status-tile-count">{count}</span>
            <span className={`status-badge status-${status}`}>{status.replace("_", " ")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { data, isLoading } = useDashboard();

  if (isLoading || !data) return <p>Loading…</p>;

  return (
    <div className="page">
      <h1>Dashboard</h1>

      <StatusTiles title="Emitters" counts={data.emitter_status_counts} />
      <StatusTiles title="MDFs" counts={data.mdf_status_counts} />

      <div className="card">
        <h4>Needs Attention</h4>
        {data.needs_attention.length === 0 ? (
          <p className="hint-text">Nothing needs attention right now.</p>
        ) : (
          <ul className="attention-list">
            {data.needs_attention.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
