import type { AmbiguitySeverity } from "../../api/ambiguity";

export function SeverityBadge({ severity }: { severity: AmbiguitySeverity }) {
  return <span className={`severity-badge severity-${severity}`}>{severity.replace("_", " ")}</span>;
}
