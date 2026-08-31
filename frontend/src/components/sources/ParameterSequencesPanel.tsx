import { useParameterSequences } from "../../state/hooks/useParameterSequences";

const STEP_COLUMNS: { key: "rf_mhz" | "pw_us" | "pri_us" | "scan_value" | "dwell_s"; label: string }[] = [
  { key: "rf_mhz", label: "RF (MHz)" },
  { key: "pw_us", label: "PW (µs)" },
  { key: "pri_us", label: "PRI (µs)" },
  { key: "scan_value", label: "Scan" },
  { key: "dwell_s", label: "Dwell (s)" },
];

/** Read-only for now — Parameter Sequences are import-only in this phase, no
 * manual creation UI yet. */
export function ParameterSequencesPanel({ emitterId, sourceId }: { emitterId: string; sourceId: string }) {
  const { data: sequences } = useParameterSequences(emitterId, sourceId);

  if (!sequences || sequences.length === 0) {
    return <p className="hint-text">None.</p>;
  }

  return (
    <div>
      {sequences.map((seq) => (
        <div key={seq.id} className="element-group">
          <h5>
            {seq.label || "Sequence"}
            {seq.variant && <span className="hint-text"> [{seq.variant.replace("_", " ")}]</span>}
          </h5>
          <table className="data-table">
            <thead>
              <tr>
                <th>Order</th>
                {STEP_COLUMNS.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {seq.steps.map((step) => (
                <tr key={step.order}>
                  <td>{step.order}</td>
                  {STEP_COLUMNS.map((c) => (
                    <td key={c.key}>{step[c.key] ?? "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
