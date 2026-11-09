import type { AmbiguitySeverity } from "../../api/ambiguity";

/** short: "Exact" instead of "exact overlap", for a badge in a narrow column. */
export function SeverityBadge({ severity, short }: { severity: AmbiguitySeverity; short?: boolean }) {
  return (
    <span className={`severity-badge severity-${severity}`} title={short ? severity.replace("_", " ") : undefined}>
      {short && severity === "exact_overlap" ? "exact" : severity.replace("_", " ")}
    </span>
  );
}
