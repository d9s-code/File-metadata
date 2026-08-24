import { useState } from "react";
import type { AmbiguityFinding, AmbiguitySeverity } from "../../api/ambiguity";
import { useReviewFinding, useUnreviewFinding } from "../../state/hooks/useAmbiguity";
import { SeverityBadge } from "./SeverityBadge";
import { RequireRole } from "../../auth/RequireAuth";

const SEVERITIES: AmbiguitySeverity[] = ["exact_overlap", "high", "medium", "low"];

export function FindingsTable({
  runId,
  findings,
  selectedId,
  onSelect,
}: {
  runId: string;
  findings: AmbiguityFinding[];
  selectedId: string | null;
  onSelect: (findingId: string) => void;
}) {
  const [severityFilter, setSeverityFilter] = useState<AmbiguitySeverity | "">("");
  const review = useReviewFinding(runId);
  const unreview = useUnreviewFinding(runId);

  const filtered = severityFilter ? findings.filter((f) => f.combined_severity === severityFilter) : findings;

  if (findings.length === 0) return <p className="hint-text">No ambiguous pairs found — nothing to flag.</p>;

  return (
    <div>
      <div className="form-row">
        <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as AmbiguitySeverity | "")}>
          <option value="">All severities</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Severity</th>
            <th>Mode A</th>
            <th>Mode B</th>
            <th>RF %</th>
            <th>PW %</th>
            <th>PRI %</th>
            <th>Reviewed</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((f) => (
            <tr
              key={f.id}
              className={f.id === selectedId ? "finding-row selected" : "finding-row"}
              onClick={() => onSelect(f.id)}
            >
              <td>
                <SeverityBadge severity={f.combined_severity} />
              </td>
              <td>
                {f.details.mode_a.mode_name}
                <span className="muted"> ({f.details.mode_a.emitter_name})</span>
              </td>
              <td>
                {f.details.mode_b.mode_name}
                <span className="muted"> ({f.details.mode_b.emitter_name})</span>
              </td>
              <td>{f.rf_overlap_pct}</td>
              <td>{f.pw_overlap_pct}</td>
              <td>{f.pri_overlap_pct ?? "n/a"}</td>
              <td>{f.reviewed_at ? `✓ ${new Date(f.reviewed_at).toLocaleDateString()}` : "—"}</td>
              <td onClick={(e) => e.stopPropagation()}>
                <RequireRole minimum="editor">
                  {f.reviewed_at ? (
                    <button className="link-button" onClick={() => void unreview.mutateAsync(f.id)}>
                      Unacknowledge
                    </button>
                  ) : (
                    <button
                      className="link-button"
                      onClick={() => void review.mutateAsync({ findingId: f.id, note: undefined })}
                    >
                      Acknowledge
                    </button>
                  )}
                </RequireRole>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
