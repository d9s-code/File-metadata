import { Link } from "react-router-dom";
import { useDashboardAdmin } from "../../state/hooks/useDashboard";
import { LoadingState } from "../common/LoadingState";

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** For admins: failed sign-ins in the last day, and Emitters held for editing
 * too long — what an admin might need to step in on. */
export function AdminCard() {
  const { data, isLoading } = useDashboardAdmin(true);
  return (
    <div className="card admin-card">
      <h4>
        <Link to="/admin/users">Admin</Link>
      </h4>
      {isLoading || !data ? (
        <LoadingState label="Loading…" />
      ) : (
        <>
          <section>
            <h5>
              Failed sign-ins, last 24 hours{" "}
              <span className={data.failed_logins_24h > 0 ? "section-count warn" : "section-count"}>
                {data.failed_logins_24h}
              </span>
            </h5>
            {data.recent_failed_logins.length === 0 ? (
              <p className="hint-text">None.</p>
            ) : (
              <ul className="admin-card-list">
                {data.recent_failed_logins.map((a) => (
                  <li key={a.id} title={a.summary}>
                    <span className="hint-text">{when(a.created_at)}</span> {a.summary}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h5>
              Held for editing over 8 hours <span className="section-count">{data.long_held_locks.length}</span>
            </h5>
            {data.long_held_locks.length === 0 ? (
              <p className="hint-text">None.</p>
            ) : (
              <>
                <ul className="admin-card-list">
                  {data.long_held_locks.slice(0, 5).map((l) => (
                    <li key={l.entity_id} title={l.message}>
                      <Link to={`/emitters/${l.entity_id}`}>{l.message.replace(/ — nobody else can edit it\.$/, "")}</Link>
                    </li>
                  ))}
                </ul>
                <Link to="/admin/checkouts">Release one under Admin → Edit locks</Link>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
