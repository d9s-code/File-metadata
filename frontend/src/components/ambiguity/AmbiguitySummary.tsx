import { useMemo } from "react";
import type { AmbiguityFinding, AmbiguitySeverity } from "../../api/ambiguity";
import { SeverityBadge } from "./SeverityBadge";

const SEVERITIES: AmbiguitySeverity[] = ["exact_overlap", "high", "medium", "low"];

/** Summarizes the whole run's findings (not the EW Group/Source-scoped
 * subset used by the matrix/table below it) — "what's the current state of
 * this scope's ambiguities" at a glance, without opening every row. */
export function AmbiguitySummary({ findings }: { findings: AmbiguityFinding[] }) {
  const stats = useMemo(() => {
    const bySeverity: Record<AmbiguitySeverity, number> = {
      none: 0,
      low: 0,
      medium: 0,
      high: 0,
      exact_overlap: 0,
    };
    let reviewed = 0;
    for (const f of findings) {
      bySeverity[f.combined_severity] += 1;
      if (f.reviewed_at) reviewed += 1;
    }
    return { total: findings.length, bySeverity, reviewed, unreviewed: findings.length - reviewed };
  }, [findings]);

  return (
    <div className="card">
      <h4>Summary</h4>
      <div className="status-summary-row">
        <span>
          <strong>{stats.total}</strong> total finding{stats.total === 1 ? "" : "s"}
        </span>
        <span>
          <strong>{stats.unreviewed}</strong> unacknowledged
        </span>
        <span>
          <strong>{stats.reviewed}</strong> acknowledged
        </span>
      </div>
      <div className="status-summary-row">
        {SEVERITIES.map((s) => (
          <span key={s}>
            <SeverityBadge severity={s} /> × {stats.bySeverity[s]}
          </span>
        ))}
      </div>
    </div>
  );
}
