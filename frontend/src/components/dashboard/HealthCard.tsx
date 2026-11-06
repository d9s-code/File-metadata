import { Link } from "react-router-dom";
import type { DashboardHealth } from "../../api/dashboard";
import { useAuth } from "../../auth/AuthContext";

interface Tile {
  label: string;
  value: number;
  hint: string;
  to?: string;
}

/** What needs a look outside the current release — a number each, coloured
 * when it's above 0. */
export function HealthCard({ health }: { health: DashboardHealth | undefined }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const tiles: Tile[] = [
    { label: "Ambiguity to review", value: health?.ambiguity ?? 0, hint: "serious overlaps nobody has looked at" },
    { label: "Intercepts not covered", value: health?.intercepts ?? 0, hint: "entries no Mode matches", to: "/intercepts" },
    {
      label: "Held for editing",
      value: health?.held_for_editing ?? 0,
      hint: "over 8 hours, by anyone",
      to: isAdmin ? "/admin/checkouts" : undefined,
    },
    { label: "Dwell testing", value: health?.dwell_testing ?? 0, hint: "Strategies untested or stale", to: "/dwells" },
  ];
  if (health?.failed_logins_24h != null) {
    tiles.push({ label: "Failed sign-ins", value: health.failed_logins_24h, hint: "in the last 24 hours", to: "/audit-log" });
  }
  return (
    <div className="card health-card">
      <div className="dashboard-card-header">
        <h2 className="as-h4">Health</h2>
        <span className="hint-text">across everything</span>
      </div>
      <div className="health-tiles" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>
        {tiles.map((t) => {
          const body = (
            <>
              <span className="readout-label">{t.label}</span>
              <span className="health-value">{health ? t.value : "–"}</span>
              <span className="hint-text">{t.hint}</span>
            </>
          );
          const cls = `health-tile${t.value > 0 ? " warn" : ""}`;
          return t.to ? (
            <Link key={t.label} className={cls} to={t.to}>
              {body}
            </Link>
          ) : (
            <div key={t.label} className={cls}>
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}
