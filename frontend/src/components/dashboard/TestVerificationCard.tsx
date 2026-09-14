import type { NeedsRedoTestItem } from "../../api/dashboard";
import { TestResultsChart } from "./TestResultsChart";
import { NeedsRedoList } from "./NeedsRedoList";

export function TestVerificationCard({
  modesPassing,
  modesTotal,
  resultCounts,
  needsRedo,
}: {
  modesPassing: number;
  modesTotal: number;
  resultCounts: Record<string, number>;
  needsRedo: NeedsRedoTestItem[];
}) {
  return (
    <div className="card">
      <h4>Test Verification</h4>
      <p>
        <strong>
          {modesPassing} / {modesTotal}
        </strong>{" "}
        Modes passing their last test, system-wide.
      </p>
      <div className="status-summary-row">
        <TestResultsChart counts={resultCounts} />
      </div>
      <h5>Needs a redo</h5>
      <NeedsRedoList items={needsRedo} />
    </div>
  );
}
