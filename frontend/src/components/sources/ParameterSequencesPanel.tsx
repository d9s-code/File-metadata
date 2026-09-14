import { useParameterSequences, useDeleteParameterSequence, useDeleteParameterSequenceStep } from "../../state/hooks/useParameterSequences";
import { useConfirmDialog } from "../common/ConfirmDialog";

const STEP_COLUMNS: { key: "rf_mhz" | "pw_us" | "pri_us" | "dwell_s"; label: string }[] = [
  { key: "rf_mhz", label: "RF (MHz)" },
  { key: "pri_us", label: "PRI (us)" },
  { key: "pw_us", label: "PW (us)" },
  { key: "dwell_s", label: "Dwell (pulses)" },
];

/** Read-only for now — Parameter Sequences are import-only in this phase, no
 * manual creation UI yet. */
export function ParameterSequencesPanel({ emitterId, sourceId }: { emitterId: string; sourceId: string }) {
  const { data: sequences } = useParameterSequences(emitterId, sourceId);
  const deleteSequence = useDeleteParameterSequence(emitterId, sourceId);
  const deleteStep = useDeleteParameterSequenceStep(emitterId, sourceId);
  const { confirmDelete, dialog } = useConfirmDialog();

  if (!sequences || sequences.length === 0) {
    return <p className="hint-text">None.</p>;
  }

  async function handleDeleteSequence(seqId: string, label: string) {
    if (await confirmDelete(`Delete sequence '${label}'?`)) {
      await deleteSequence.mutateAsync(seqId);
    }
  }

  async function handleDeleteStep(seqId: string, order: number) {
    if (await confirmDelete(`Delete step ${order}?`)) {
      await deleteStep.mutateAsync({ sequenceId: seqId, stepOrder: order });
    }
  }

  return (
    <div>
      {sequences.map((seq) => (
        <div key={seq.id} className="element-group">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h5 style={{ margin: 0 }}>
              {seq.label || "Sequence"}
              {seq.variant && <span className="hint-text"> [{seq.variant.replace("_", " ")}]</span>}
            </h5>
            <button 
              className="link-button" 
              onClick={() => void handleDeleteSequence(seq.id, seq.label || "unnamed")}
              disabled={deleteSequence.isPending}
            >
              Delete Sequence
            </button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Order</th>
                {STEP_COLUMNS.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {seq.steps.map((step) => (
                <tr key={step.order}>
                  <td>{step.order}</td>
                  {STEP_COLUMNS.map((c) => (
                    <td key={c.key}>{step[c.key] ?? "—"}</td>
                  ))}
                  <td>
                    <button 
                      className="link-button" 
                      onClick={() => void handleDeleteStep(seq.id, step.order)}
                      disabled={deleteStep.isPending}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {dialog}
    </div>
  );
}
