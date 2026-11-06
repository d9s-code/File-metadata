import { Link } from "react-router-dom";
import type { NeedsRedoTestItem, RecentTestRun } from "../../api/dashboard";
import type { TestResult } from "../../types/domain";
import { formatDate } from "../common/dates";
import { EmptyState } from "../common/EmptyState";
import { mdfTestLink, testLink } from "../modes/TestDerivedBadge";
import { lineOutcomeLabel, testResultLabel, testTypeLabel } from "../testing/testFormat";

/** Rows each card shows, so the Testing row stays one height. */
const SHOWN = 6;
const OUTCOME_ORDER: TestResult[] = ["pass", "partial", "fail", "inconclusive"];

function runLink(run: { entity_type: "emitter" | "mdf"; entity_id: string; test_record_id: string }): string {
  return run.entity_type === "emitter" ? testLink(run.entity_id, run.test_record_id) : mdfTestLink(run.entity_id, run.test_record_id);
}

function lineSummary(counts: Record<TestResult, number> | null): string {
  if (!counts) return "";
  return OUTCOME_ORDER.filter((o) => counts[o] > 0)
    .map((o) => `${counts[o]} ${lineOutcomeLabel(o)}`)
    .join(" · ");
}

/** The latest Simulation and Intercept Tests logged, newest first. */
export function LatestRunsCard({ runs }: { runs: RecentTestRun[] }) {
  return (
    <div className="card">
      <div className="dashboard-card-header">
        <h2 className="as-h4">Latest test runs</h2>
      </div>
      {runs.length === 0 ? (
        <EmptyState icon="—" title="No runs yet" message="Logged Simulation and Intercept Tests show up here." compact />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Run</th>
              <th>On</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {runs.slice(0, SHOWN).map((run) => (
              <tr key={run.test_record_id}>
                <td className="nowrap">{formatDate(run.test_date)}</td>
                <td>
                  <Link to={runLink(run)}>{run.title}</Link>
                  <span className="jitter-subline">
                    {testTypeLabel(run.test_type)}
                    {run.line_outcomes && ` · ${lineSummary(run.line_outcomes)}`}
                  </span>
                </td>
                <td>{run.entity_name}</td>
                <td>
                  <span className={`test-result-badge test-result-${run.result}`}>{testResultLabel(run.result)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Tests whose latest run didn't pass and have no retest on file. */
export function NeedsRedoCard({ items }: { items: NeedsRedoTestItem[] }) {
  return (
    <div className="card">
      <div className="dashboard-card-header">
        <h2 className="as-h4">
          Needs a redo {items.length > 0 && <span className="section-count">{items.length}</span>}
        </h2>
        <span className="hint-text">failed or partial, no retest yet</span>
      </div>
      {items.length === 0 ? (
        <EmptyState icon="✓" title="Nothing to redo" message="Every failed or partial test has a retest on file." compact />
      ) : (
        <>
          <ul className="redo-list">
            {items.slice(0, SHOWN).map((item) => (
              <li key={item.test_record_id}>
                <Link to={runLink(item)}>{item.entity_name}</Link>
                <span className="hint-text">
                  {item.title} · {formatDate(item.test_date)}
                </span>
                <span className={`test-result-badge test-result-${item.result}`}>{testResultLabel(item.result)}</span>
              </li>
            ))}
          </ul>
          {items.length > SHOWN && <p className="hint-text redo-more">and {items.length - SHOWN} more</p>}
        </>
      )}
    </div>
  );
}
