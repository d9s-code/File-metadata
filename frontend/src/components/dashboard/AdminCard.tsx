import { Link } from "react-router-dom";
import { auditSummary } from "../audit/auditFormat";
import { formatDateTime } from "../common/dates";
import { useDashboardAdmin } from "../../state/hooks/useDashboard";
import { LoadingState } from "../common/LoadingState";

function when(iso: string) {
  return formatDateTime(iso);
}

/** For admins: failed sign-ins in the last day, and Emitters held for editing
 * too long — what an admin might need to step in on. */
export function AdminCard() {
  const { data, isLoading } = useDashboardAdmin(true);
  return (
    <div className="card admin-card">
      <h2 className="as-h4">
        <Link to="/admin/users">Admin</Link>
      </h2>
      {isLoading || !data ? (
        <LoadingState label="Loading…" />
      ) : (
        <>
          <section>
            <h3 className="as-h5">
              Failed sign-ins, last 24 hours{" "}
              <span className={data.failed_logins_24h > 0 ? "section-count warn" : "section-count"}>
                {data.failed_logins_24h}
              </span>
            </h3>
            {data.recent_failed_logins.length === 0 ? (
              <p className="hint-text">None.</p>
            ) : (
              <ul className="admin-card-list">
                {data.recent_failed_logins.map((a) => (
                  <li key={a.id} title={auditSummary(a.summary)}>
                    <span className="hint-text">{when(a.created_at)}</span> {auditSummary(a.summary)}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3 className="as-h5">
              Held for editing over 8 hours <span className="section-count">{data.long_held_locks.length}</span>
            </h3>
            {data.long_held_locks.length === 0 ? (
              <p className="hint-text">None.</p>
            ) : (
              <Link to="/admin/checkouts">See who holds them, and release one, under Edit locks →</Link>
            )}
          </section>
        </>
      )}
    </div>
  );
}
