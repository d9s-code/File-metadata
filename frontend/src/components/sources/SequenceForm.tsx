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

export function SequenceForm({ emitterId, sourceId, canEdit }: { emitterId: string; sourceId: string; canEdit: boolean }) {
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
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to create sequence");
    }
  }

  return (
    <form className="card space-y-4" onSubmit={handleSubmit}>
      <div className="flex items-end gap-4">
        <div className="flex flex-col gap-1 flex-grow">
          <label className="text-xs font-semibold uppercase text-gray-500">Sequence Label</label>
          <input placeholder="Sequence Name" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="data-table">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs uppercase font-medium">
            <tr>
              <th className="px-2 py-2 w-16 text-center">Order</th>
              <th className="px-2 py-2">RF (MHz)</th>
              <th className="px-2 py-2">PRI (us)</th>
              <th className="px-2 py-2">PW (us)</th>
              <th className="px-2 py-2">Dwell (pulses)</th>
              <th className="px-2 py-2 w-16 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {steps.map((step, index) => (
              <tr key={index} className="hover:bg-gray-50 transition-colors">
                <td className="px-2 py-1 text-center font-mono text-gray-500">{step.order + 1}</td>
                <td className="px-2 py-1">
                  <input 
                    ref={(el) => { if (el) rfInputsRef.current[index] = el; }}
                    type="number" step="any" 
                    className="w-full bg-transparent"
                    value={step.rf_mhz ?? ""} 
                    onChange={(e) => updateStep(index, "rf_mhz", e.target.value ? Number(e.target.value) : null)}
                  />
                </td>
                <td className="px-2 py-1">
                  <input 
                    type="number" step="any" 
                    className="w-full bg-transparent"
                    value={step.pri_us ?? ""} 
                    onChange={(e) => updateStep(index, "pri_us", e.target.value ? Number(e.target.value) : null)}
                  />
                </td>
                <td className="px-2 py-1">
                  <input 
                    type="number" step="any" 
                    className="w-full bg-transparent"
                    value={step.pw_us ?? ""} 
                    onChange={(e) => updateStep(index, "pw_us", e.target.value ? Number(e.target.value) : null)}
                  />
                </td>
                <td className="px-2 py-1">
                  <input 
                    type="number" step="any" 
                    className="w-full bg-transparent"
                    value={step.dwell_s ?? ""} 
                    onChange={(e) => updateStep(index, "dwell_s", e.target.value ? Number(e.target.value) : null)}
                  />
                </td>
                <td className="px-2 py-1 text-center">
                  <button 
                    type="button" 
                    onClick={() => removeStep(index)}
                    className="text-red-500 hover:text-red-700 font-bold"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center mt-4" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
        <div className="flex items-center gap-2">
          <button 
            type="button" 
            onClick={addStep} 
            className="text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-3 py-1 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            + Add Step
          </button>
          {error && <div className="error-text">{error}</div>}
        </div>
        <button
          type="submit"
          disabled={createSequence.isPending || !canEdit}
          title={canEdit ? undefined : "Start editing this Emitter first"}
          className="bg-blue-600 text-white px-4 py-2 rounded font-bold hover:bg-blue-700 disabled:opacity-50"
        >
          {createSequence.isPending ? "Creating..." : "Create Sequence"}
        </button>
      </div>
    </form>
  );
}
