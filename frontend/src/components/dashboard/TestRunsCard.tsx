import { Link } from "react-router-dom";
import type { NeedsRedoTestItem, RecentTestRun } from "../../api/dashboard";
import type { TestResult } from "../../types/domain";
import { EmptyState } from "../common/EmptyState";
import { mdfTestLink, testLink } from "../modes/TestDerivedBadge";
import { lineOutcomeLabel, testTypeLabel } from "../testing/testFormat";
import { NeedsRedoList } from "./NeedsRedoList";

const OUTCOME_ORDER: TestResult[] = ["pass", "partial", "fail", "inconclusive"];

function runLink(run: RecentTestRun): string {
  return run.entity_type === "emitter"
    ? testLink(run.entity_id, run.test_record_id)
    : mdfTestLink(run.entity_id, run.test_record_id);
}

function lineSummary(counts: Record<TestResult, number> | null): string {
  if (!counts) return "";
  return OUTCOME_ORDER.filter((o) => counts[o] > 0)
    .map((o) => `${counts[o]} ${lineOutcomeLabel(o)}`)
    .join(" · ");
}

export function TestRunsCard({ runs, needsRedo }: { runs: RecentTestRun[]; needsRedo: NeedsRedoTestItem[] }) {
  return (
    <div className="card">
      <h4>Test Runs</h4>
      <h5>Latest</h5>
      {runs.length === 0 ? (
        <EmptyState icon="—" title="No runs yet" message="Logged simulation and intercept runs show up here." />
      ) : (
        <div className="dashboard-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Run</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.test_record_id}>
                  <td className="nowrap">{run.test_date}</td>
                  <td>
                    <Link to={runLink(run)}>{run.title}</Link>
                    <span className="jitter-subline">
                      {run.entity_name} · {testTypeLabel(run.test_type)}
                      {run.line_outcomes && ` · ${lineSummary(run.line_outcomes)}`}
                    </span>
                  </td>
                  <td>
                    <span className={`test-result-badge test-result-${run.result}`}>{run.result}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h5 className="dashboard-subheading">Needs a redo</h5>
      <NeedsRedoList items={needsRedo} />
    </div>
  );
}
