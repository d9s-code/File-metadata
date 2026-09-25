import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { EmitterSimStatus } from "../../api/dashboard";
import { emitterStatusLabel } from "../common/emitterStatusLabel";
import { EmptyState } from "../common/EmptyState";
import { testLink } from "../modes/TestDerivedBadge";
import { SimOutcomeBar } from "./SimOutcomeBar";

type Filter = "problems" | "with_lines" | "all";

function wrongCount(r: EmitterSimStatus): number {
  return r.line_outcomes.fail + r.line_outcomes.partial;
}

function needsLook(r: EmitterSimStatus): boolean {
  return r.line_count > 0 && (wrongCount(r) > 0 || r.line_outcomes.untested > 0 || r.changed_since_validation);
}

/** One compact row per Emitter — searchable, filterable and scrolling
 * inside a fixed height, so it stays the same size however many Emitters
 * there are. Worst first: missed/misclassified lines, then untested ones. */
export function EmitterSimTable({ rows }: { rows: EmitterSimStatus[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("with_lines");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => (filter === "all" ? true : filter === "with_lines" ? r.line_count > 0 : needsLook(r)))
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          wrongCount(b) - wrongCount(a) ||
          b.line_outcomes.untested - a.line_outcomes.untested ||
          a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
  }, [rows, query, filter]);

  return (
    <div className="card dashboard-wide">
      <div className="dashboard-card-header">
        <h4>Emitters by SIM Test Line status</h4>
        <div className="dashboard-card-tools">
          <input
            type="search"
            placeholder="Find an Emitter…"
            aria-label="Find an Emitter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Which Emitters">
            <option value="problems">Needing a look</option>
            <option value="with_lines">With SIM Test Lines</option>
            <option value="all">All Emitters</option>
          </select>
        </div>
      </div>
      {shown.length === 0 ? (
        <EmptyState
          icon="✓"
          title={filter === "problems" ? "Nothing needs a look" : "No Emitters to show"}
          message={
            filter === "problems"
              ? "Every tested SIM Test Line was correct in its latest run."
              : "No Emitter matches — try another filter."
          }
        />
      ) : (
        <div className="dashboard-table-scroll dashboard-table-tall">
          <table className="data-table">
            <thead>
              <tr>
                <th>Emitter</th>
                <th>Status</th>
                <th>SIM Test Lines (latest outcome)</th>
                <th>Last validated</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.emitter_id}>
                  <td>
                    <Link to={`/emitters/${r.emitter_id}?tab=tests`}>{r.name}</Link>
                  </td>
                  <td>
                    <span className={`status-badge status-${r.status}`}>{emitterStatusLabel(r.status)}</span>
                  </td>
                  <td className="sim-lines-cell">
                    {r.line_count === 0 ? (
                      <span className="hint-text">none yet</span>
                    ) : (
                      <>
                        <SimOutcomeBar counts={r.line_outcomes} />
                        <span className="progress-bar-label">
                          {r.line_outcomes.pass} / {r.line_count} correct
                          {wrongCount(r) > 0 && ` · ${wrongCount(r)} missed/misclassified`}
                          {r.line_outcomes.untested > 0 && ` · ${r.line_outcomes.untested} untested`}
                        </span>
                      </>
                    )}
                  </td>
                  <td>
                    {r.last_validated_at && r.last_validated_test_record_id ? (
                      <>
                        <Link to={testLink(r.emitter_id, r.last_validated_test_record_id)}>{r.last_validated_at}</Link>
                        {r.changed_since_validation && (
                          <span className="status-badge status-in_review" title="Changed and committed after this test">
                            changed since
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="hint-text">never</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint-text dashboard-card-footer">
        {shown.length} of {rows.length} Emitters shown
      </p>
    </div>
  );
}
