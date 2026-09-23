import { useState } from "react";
import type { ParameterSequence } from "../../types/domain";
import {
  useParameterSequences,
  useDeleteParameterSequence,
  useDeleteParameterSequenceStep,
  useUpdateParameterSequence,
} from "../../state/hooks/useParameterSequences";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";

const STEP_COLUMNS: { key: "rf_mhz" | "pw_us" | "pri_us" | "dwell_s"; label: string }[] = [
  { key: "rf_mhz", label: "RF (MHz)" },
  { key: "pri_us", label: "PRI (us)" },
  { key: "pw_us", label: "PW (us)" },
  { key: "dwell_s", label: "Dwell (pulses)" },
];

/** A sequence with no step touching rf_mhz/pw_us — delta override doesn't
 * apply to it (every value it can contribute is a PRI point value). */
function isPriOnlySequence(seq: ParameterSequence): boolean {
  return seq.steps.every((s) => s.rf_mhz == null && s.pw_us == null);
}

function SequenceDeltaEditor({
  emitterId,
  sourceId,
  sequence,
  canEdit,
}: {
  emitterId: string;
  sourceId: string;
  sequence: ParameterSequence;
  canEdit: boolean;
}) {
  const updateSequence = useUpdateParameterSequence(emitterId, sourceId);
  const [rfDelta, setRfDelta] = useState(sequence.rf_delta?.toString() ?? "");
  const [pwDelta, setPwDelta] = useState(sequence.pw_delta?.toString() ?? "");
  const [priDelta, setPriDelta] = useState(sequence.pri_delta?.toString() ?? "");

  function commit(field: "rf_delta" | "pw_delta" | "pri_delta", raw: string) {
    const value = raw.trim() === "" ? null : Number(raw);
    if (value != null && Number.isNaN(value)) return;
    updateSequence.mutate({ sequenceId: sequence.id, input: { [field]: value } });
  }

  return (
    <div className="form-row" style={{ marginTop: "0.5rem" }}>
      <label>
        RF delta (±MHz)
        <input
          type="number"
          step="any"
          min="0"
          value={rfDelta}
          disabled={!canEdit}
          title={canEdit ? undefined : "Start editing this Emitter first"}
          onChange={(e) => setRfDelta(e.target.value)}
          onBlur={() => commit("rf_delta", rfDelta)}
        />
      </label>
      <label>
        PRI delta (±µs)
        <input
          type="number"
          step="any"
          min="0"
          value={priDelta}
          disabled={!canEdit}
          title={canEdit ? undefined : "Start editing this Emitter first"}
          onChange={(e) => setPriDelta(e.target.value)}
          onBlur={() => commit("pri_delta", priDelta)}
        />
      </label>
      <label>
        PW delta (±µs)
        <input
          type="number"
          step="any"
          min="0"
          value={pwDelta}
          disabled={!canEdit}
          title={canEdit ? undefined : "Start editing this Emitter first"}
          onChange={(e) => setPwDelta(e.target.value)}
          onBlur={() => commit("pw_delta", pwDelta)}
        />
      </label>
    </div>
  );
}

export function ParameterSequencesPanel({ emitterId, sourceId }: { emitterId: string; sourceId: string }) {
  const { data: sequences } = useParameterSequences(emitterId, sourceId);
  const deleteSequence = useDeleteParameterSequence(emitterId, sourceId);
  const deleteStep = useDeleteParameterSequenceStep(emitterId, sourceId);
  const { confirmDelete, dialog } = useConfirmDialog();
  const { data: emitter } = useEmitter(emitterId);
  const { canEdit } = useEmitterCheckoutState(emitter);

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
              className="link-button link-button-danger"
              onClick={() => void handleDeleteSequence(seq.id, seq.label || "unnamed")}
              disabled={deleteSequence.isPending || !canEdit}
              title={canEdit ? undefined : "Start editing this Emitter first"}
            >
              Delete Sequence
            </button>
          </div>
          {!isPriOnlySequence(seq) && (
            <SequenceDeltaEditor emitterId={emitterId} sourceId={sourceId} sequence={seq} canEdit={canEdit} />
          )}
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
                      className="link-button link-button-danger"
                      onClick={() => void handleDeleteStep(seq.id, step.order)}
                      disabled={deleteStep.isPending || !canEdit}
                      title={canEdit ? undefined : "Start editing this Emitter first"}
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
