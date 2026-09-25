import type { EmitterSimStatus, SimOutcomeCounts } from "../../api/dashboard";
import { EmptyState } from "../common/EmptyState";
import { SimOutcomeBar, SimOutcomeLegend } from "./SimOutcomeBar";

/** System-wide: how every SIM Test Line did in its latest run, and how many
 * Emitters came out correct. */
export function SimValidationCard({ counts, rows }: { counts: SimOutcomeCounts; rows: EmitterSimStatus[] }) {
  const withLines = rows.filter((r) => r.line_count > 0);
  const allCorrect = withLines.filter((r) => r.line_outcomes.pass === r.line_count).length;
  const neverTested = withLines.filter((r) => r.last_validated_at === null).length;
  const noLines = rows.length - withLines.length;

  return (
    <div className="card">
      <h4>Simulation Validation</h4>
      {withLines.length === 0 ? (
        <EmptyState
          icon="—"
          title="No SIM Test Lines yet"
          message="Import SIM Test Lines on an Emitter and log a run to see results here."
        />
      ) : (
        <>
          <p className="sim-headline">
            <strong>
              {allCorrect} / {withLines.length}
            </strong>{" "}
            Emitters had every SIM Test Line correct in its latest run.
          </p>
          <SimOutcomeBar counts={counts} />
          <SimOutcomeLegend counts={counts} />
          <p className="hint-text">
            {neverTested > 0 && `${neverTested} with SIM Test Lines never tested. `}
            {noLines > 0 && `${noLines} Emitter${noLines === 1 ? " has" : "s have"} no SIM Test Lines yet.`}
          </p>
        </>
      )}
    </div>
  );
}
