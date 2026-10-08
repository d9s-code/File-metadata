import { Link } from "react-router-dom";
import type { TestResult } from "../../types/domain";
import { lineOutcomeLabel, TEST_RESULTS } from "../testing/testFormat";
import { testLink } from "./TestDerivedBadge";

/** "Last seen": the latest test run a Mode turned up in — reported for a SIM
 * line, or rated in an intercept run — with that run's outcome for it,
 * linking to the run. Hover: how every run it was seen in went. */
export function LastTestedCell({
  emitterId,
  date,
  result,
  testRecordId,
  counts,
}: {
  emitterId: string;
  date: string;
  result: TestResult | null;
  testRecordId: string | null;
  counts?: Record<string, number>;
}) {
  const runs = Object.values(counts ?? {}).reduce((a, b) => a + b, 0);
  const title = runs
    ? `Seen in ${runs} run${runs === 1 ? "" : "s"}: ` +
      TEST_RESULTS.filter((r) => counts?.[r])
        .map((r) => `${counts![r]} ${lineOutcomeLabel(r)}`)
        .join(", ")
    : undefined;
  const content = (
    <span title={title}>
      {date}
      {result && <span className={`test-result-badge test-result-${result}`}>{lineOutcomeLabel(result)}</span>}
      {runs > 1 && <span className="hint-text"> · {runs} runs</span>}
    </span>
  );
  if (!testRecordId) return content;
  return <Link to={testLink(emitterId, testRecordId)}>{content}</Link>;
}
