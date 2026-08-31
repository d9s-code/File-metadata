import type { AuditLogEntry } from "../../types/domain";
import { actionLabel } from "../audit/auditFormat";
import { EmptyState } from "../common/EmptyState";

function compactWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function RecentActivityCard({ entries }: { entries: AuditLogEntry[] }) {
  return (
    <div className="card">
      <h4>Recent Activity</h4>
      {entries.length === 0 ? (
        <EmptyState icon="—" title="Nothing yet" message="No activity has been logged." />
      ) : (
        <div className="dashboard-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{compactWhen(e.created_at)}</td>
                  <td>{e.actor_username ?? <span className="hint-text">system</span>}</td>
                  <td>
                    <span className={`audit-action-badge audit-action-${e.action}`}>{actionLabel(e.action)}</span>
                  </td>
                  <td className="dashboard-table-summary" title={e.summary}>
                    {e.summary}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
