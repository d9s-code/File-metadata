import type { SimOutcomeCounts } from "../../api/dashboard";
import { lineOutcomeLabel } from "../testing/testFormat";

export const SIM_OUTCOMES = ["pass", "partial", "fail", "inconclusive", "untested"] as const;
export type SimOutcome = (typeof SIM_OUTCOMES)[number];

export function simOutcomeLabel(outcome: SimOutcome): string {
  return outcome === "untested" ? "untested" : lineOutcomeLabel(outcome);
}

/** One stacked bar of SIM Test Line outcomes (correct, misclassified,
 * missed, inconclusive, untested). */
export function SimOutcomeBar({ counts }: { counts: SimOutcomeCounts }) {
  const total = SIM_OUTCOMES.reduce((sum, o) => sum + counts[o], 0);
  const summary = SIM_OUTCOMES.filter((o) => counts[o] > 0)
    .map((o) => `${counts[o]} ${simOutcomeLabel(o)}`)
    .join(", ");
  return (
    <div className="sim-bar" role="img" aria-label={summary || "No SIM Test Lines"} title={summary}>
      {total > 0 &&
        SIM_OUTCOMES.filter((o) => counts[o] > 0).map((o) => (
          <span key={o} className={`sim-bar-segment sim-${o}`} style={{ width: `${(counts[o] / total) * 100}%` }} />
        ))}
    </div>
  );
}

export function SimOutcomeLegend({ counts }: { counts: SimOutcomeCounts }) {
  return (
    <ul className="sim-legend">
      {SIM_OUTCOMES.map((o) => (
        <li key={o}>
          <span className={`sim-legend-swatch sim-${o}`} />
          <strong>{counts[o]}</strong> {simOutcomeLabel(o)}
        </li>
      ))}
    </ul>
  );
}
