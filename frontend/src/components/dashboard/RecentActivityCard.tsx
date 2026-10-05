import { useState } from "react";
import { Link } from "react-router-dom";
import type { AuditLogEntry } from "../../types/domain";
import { useDashboardActivity } from "../../state/hooks/useDashboard";
import { LoadingState } from "../common/LoadingState";
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

/** The latest changes. Sign-ins and starting or ending an edit are left out
 * unless asked for — they'd crowd out the changes themselves. */
export function RecentActivityCard({ wide }: { wide: boolean }) {
  const [everything, setEverything] = useState(false);
  const { data, isLoading } = useDashboardActivity(everything);
  const entries: AuditLogEntry[] = data?.recent_activity ?? [];
  return (
    <div className={wide ? "card dashboard-wide" : "card"}>
      <div className="dashboard-card-header">
        <h4>
          <Link to="/audit-log">Recent Activity</Link>
        </h4>
        <label className="inline-label hint-text">
          <input type="checkbox" checked={everything} onChange={(e) => setEverything(e.target.checked)} />
          Sign-ins &amp; edit locks too
        </label>
      </div>
      {isLoading ? (
        <LoadingState label="Loading activity…" />
      ) : entries.length === 0 ? (
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
                  <td className="nowrap">{compactWhen(e.created_at)}</td>
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
