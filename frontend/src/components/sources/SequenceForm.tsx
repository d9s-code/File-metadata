import { useState, type FormEvent, useRef, useEffect } from "react";
import { useCreateParameterSequence } from "../../state/hooks/useParameterSequences";
import { ApiRequestError } from "../../api/client";

interface StepState {
  order: number;
  rf_mhz?: number | null;
  pw_us?: number | null;
  pri_us?: number | null;
  scan_value?: number | null;
  dwell_s?: number | null;
}

export function SequenceForm({
  emitterId,
  sourceId,
  canEdit,
  onCancel,
  onAdded,
}: {
  emitterId: string;
  sourceId: string;
  canEdit: boolean;
  onCancel?: () => void;
  onAdded?: () => void;
}) {
  const createSequence = useCreateParameterSequence(emitterId, sourceId);
  const [label, setLabel] = useState("");
  const [steps, setSteps] = useState<StepState[]>([{
    order: 0,
    rf_mhz: undefined,
    pw_us: undefined,
    pri_us: undefined,
    scan_value: undefined,
    dwell_s: undefined,
  }]);
  const [error, setError] = useState<string | null>(null);
  const rfInputsRef = useRef<HTMLInputElement[]>([]);

  useEffect(() => {
    if (rfInputsRef.current[rfInputsRef.current.length - 1]) {
      rfInputsRef.current[rfInputsRef.current.length - 1].focus();
    }
  }, [steps.length]);

  const addStep = () => {
    setSteps([...steps, {
      order: steps.length,
      rf_mhz: undefined,
      pw_us: undefined,
      pri_us: undefined,
      scan_value: undefined,
      dwell_s: undefined,
    }]);
  };

  const removeStep = (index: number) => {
    if (steps.length > 1) {
      const newSteps = steps.filter((_, i) => i !== index);
      setSteps(newSteps.map((step, i) => ({ ...step, order: i })));
    }
  };

  const updateStep = (index: number, field: keyof StepState, value: number | null) => {
    const newSteps = [...steps];
    newSteps[index] = { ...newSteps[index], [field]: value };
    setSteps(newSteps);
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createSequence.mutateAsync({
        label: label || undefined,
        steps: steps.map(s => ({
          order: s.order,
          rf_mhz: s.rf_mhz ?? undefined,
          pw_us: s.pw_us ?? undefined,
          pri_us: s.pri_us ?? undefined,
          scan_value: s.scan_value ?? undefined,
          dwell_s: s.dwell_s ?? undefined,
        })),
      });
      setLabel("");
      setSteps([{ order: 0, rf_mhz: undefined, pw_us: undefined, pri_us: undefined, scan_value: undefined, dwell_s: undefined }]);
      onAdded?.();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to create sequence");
    }
  }

  const cell = (index: number, field: "rf_mhz" | "pri_us" | "pw_us" | "dwell_s", label: string, first = false) => (
    <td>
      <input
        ref={first ? (el) => { if (el) rfInputsRef.current[index] = el; } : undefined}
        type="number"
        step="any"
        aria-label={`Step ${index + 1} ${label}`}
        value={steps[index][field] ?? ""}
        onChange={(e) => updateStep(index, field, e.target.value ? Number(e.target.value) : null)}
      />
    </td>
  );

  return (
    <form className="seq-form" onSubmit={handleSubmit} aria-label="Add a sequence">
      <div className="seq-form-head">
        <label>
          Label
          <input placeholder="e.g. Burst A" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        {onCancel && (
          <button type="button" className="button secondary small" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="button primary small" disabled={createSequence.isPending || !canEdit}>
          {createSequence.isPending ? "Adding…" : "Add sequence"}
        </button>
      </div>
      <div className="long-list-scroll">
        <table className="data-table compact seq-form-table">
          <thead>
            <tr>
              <th className="num">Step</th>
              <th>RF (MHz)</th>
              <th>PRI (µs)</th>
              <th>PW (µs)</th>
              <th>Dwell (pulses)</th>
              <th aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {steps.map((step, index) => (
              <tr key={index}>
                <td className="num hint-text">{step.order + 1}</td>
                {cell(index, "rf_mhz", "RF", true)}
                {cell(index, "pri_us", "PRI")}
                {cell(index, "pw_us", "PW")}
                {cell(index, "dwell_s", "dwell")}
                <td>
                  <button
                    type="button"
                    className="el-delete"
                    onClick={() => removeStep(index)}
                    disabled={steps.length === 1}
                    aria-label={`Remove step ${index + 1}`}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="seq-form-foot">
        <button type="button" className="button secondary small" onClick={addStep}>
          + Add step
        </button>
        {error && <span className="error-text">{error}</span>}
      </div>
    </form>
  );
}
