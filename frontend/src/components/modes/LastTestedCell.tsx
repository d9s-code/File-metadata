import { Link } from "react-router-dom";
import type { TestResult } from "../../types/domain";
import { testLink } from "./TestDerivedBadge";

export function LastTestedCell({
  emitterId,
  date,
  result,
  testRecordId,
}: {
  emitterId: string;
  date: string;
  result: TestResult | null;
  testRecordId: string | null;
}) {
  const content = (
    <>
      {date}
      {result && <span className={`test-result-badge test-result-${result}`}>{result}</span>}
    </>
  );
  if (!testRecordId) return content;
  return <Link to={testLink(emitterId, testRecordId)}>{content}</Link>;
}
