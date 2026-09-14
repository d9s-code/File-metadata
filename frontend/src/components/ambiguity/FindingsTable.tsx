import { useState } from "react";
import type { AmbiguityFinding, AmbiguitySeverity } from "../../api/ambiguity";
import { useReviewFinding, useUnreviewFinding } from "../../state/hooks/useAmbiguity";
import { SeverityBadge } from "./SeverityBadge";
import { RequireRole } from "../../auth/RequireAuth";
import { SortableColumnHeader } from "../common/SortableColumnHeader";
import { useSortableTable } from "../common/useSortableTable";
import { compareNullable, compareStrings } from "../common/sortUtils";

const SEVERITIES: AmbiguitySeverity[] = ["exact_overlap", "high", "medium", "low"];
const SEVERITY_RANK: Record<AmbiguitySeverity, number> = { exact_overlap: 0, high: 1, medium: 2, low: 3, none: 4 };

type FindingSortKey = "severity" | "mode_a" | "mode_b" | "rf_pct" | "pw_pct" | "pri_pct" | "reviewed";

function compareFindings(a: AmbiguityFinding, b: AmbiguityFinding, key: FindingSortKey, dir: "asc" | "desc"): number {
  switch (key) {
    case "severity":
      return compareNullable(SEVERITY_RANK[a.combined_severity], SEVERITY_RANK[b.combined_severity], dir);
    case "mode_a":
      return compareStrings(a.details.mode_a.mode_name, b.details.mode_a.mode_name, dir);
    case "mode_b":
      return compareStrings(a.details.mode_b.mode_name, b.details.mode_b.mode_name, dir);
    case "rf_pct":
      return compareNullable(a.rf_overlap_pct, b.rf_overlap_pct, dir);
    case "pw_pct":
      return compareNullable(a.pw_overlap_pct, b.pw_overlap_pct, dir);
    case "pri_pct":
      return compareNullable(a.pri_overlap_pct, b.pri_overlap_pct, dir);
    case "reviewed":
      return compareNullable(a.reviewed_at, b.reviewed_at, dir);
  }
}

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
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(filtered, compareFindings);

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
            <SortableColumnHeader label="Severity" columnKey="severity" activeKey={sortKey} activeDir={sortDir} onSort={onSort} onClear={onClear} />
            <SortableColumnHeader label="Mode A" columnKey="mode_a" activeKey={sortKey} activeDir={sortDir} onSort={onSort} onClear={onClear} />
            <SortableColumnHeader label="Mode B" columnKey="mode_b" activeKey={sortKey} activeDir={sortDir} onSort={onSort} onClear={onClear} />
            <SortableColumnHeader
              label="RF %"
              columnKey="rf_pct"
              columnType="number"
              activeKey={sortKey}
              activeDir={sortDir}
              onSort={onSort}
              onClear={onClear}
            />
            <SortableColumnHeader
              label="PW %"
              columnKey="pw_pct"
              columnType="number"
              activeKey={sortKey}
              activeDir={sortDir}
              onSort={onSort}
              onClear={onClear}
            />
            <SortableColumnHeader
              label="PRI %"
              columnKey="pri_pct"
              columnType="number"
              activeKey={sortKey}
              activeDir={sortDir}
              onSort={onSort}
              onClear={onClear}
            />
            <SortableColumnHeader
              label="Reviewed"
              columnKey="reviewed"
              columnType="date"
              activeKey={sortKey}
              activeDir={sortDir}
              onSort={onSort}
              onClear={onClear}
            />
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((f) => (
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
