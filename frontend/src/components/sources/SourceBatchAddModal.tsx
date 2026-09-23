import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Modal } from "../common/Modal";
import { elementsApi } from "../../api/elements";
import { parameterSequencesApi } from "../../api/parameterSequences";
import { elementsKey } from "../../state/hooks/useElements";
import { parameterSequencesKey } from "../../state/hooks/useParameterSequences";
import { ApiRequestError } from "../../api/client";
import type { ElementType, ElementVariant } from "../../types/domain";

const ELEMENT_TYPES: ElementType[] = ["rf", "pri", "pw", "scan"];

interface StepState {
  order: number;
  rf_mhz?: number | null;
  pw_us?: number | null;
  pri_us?: number | null;
  scan_value?: number | null;
  dwell_s?: number | null;
}

interface Outcome {
  sourceId: string;
  sourceName: string;
  error: string;
}

export function SourceBatchAddModal({
  emitterId,
  sourceIds,
  sourceNameById,
  onClose,
  onDone,
}: {
  emitterId: string;
  sourceIds: string[];
  sourceNameById: Record<string, string>;
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"element" | "sequence">("element");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failures, setFailures] = useState<Outcome[] | null>(null);
  const [genericError, setGenericError] = useState<string | null>(null);

  // Element tab fields — mirrors ElementForm in ElementsPanel.tsx
  const [elementType, setElementType] = useState<ElementType>("rf");
  const [variant, setVariant] = useState<ElementVariant>("typical");
  const [priShape, setPriShape] = useState<"range" | "stagger">("range");
  const [valueMin, setValueMin] = useState("");
  const [valueMax, setValueMax] = useState("");
  const [jitterMin, setJitterMin] = useState("0");
  const [jitterMax, setJitterMax] = useState("1");
  const [staggerValues, setStaggerValues] = useState("");
  const [label, setLabel] = useState("");
  const [details, setDetails] = useState("");

  // Sequence tab fields — mirrors SequenceForm.tsx
  const [seqLabel, setSeqLabel] = useState("");
  const [steps, setSteps] = useState<StepState[]>([
    { order: 0, rf_mhz: undefined, pw_us: undefined, pri_us: undefined, scan_value: undefined, dwell_s: undefined },
  ]);

  const usesStagger = elementType === "pri" && priShape === "stagger";

  function addStep() {
    setSteps([
      ...steps,
      { order: steps.length, rf_mhz: undefined, pw_us: undefined, pri_us: undefined, scan_value: undefined, dwell_s: undefined },
    ]);
  }

  function removeStep(index: number) {
    if (steps.length > 1) {
      const next = steps.filter((_, i) => i !== index);
      setSteps(next.map((step, i) => ({ ...step, order: i })));
    }
  }

  function updateStep(index: number, field: keyof StepState, value: number | null) {
    const next = [...steps];
    next[index] = { ...next[index], [field]: value };
    setSteps(next);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setGenericError(null);
    setFailures(null);

    if (mode === "element" && variant === "analysis" && !details.trim()) {
      setGenericError("Selecting the 'analysis' variant requires a note in Notes.");
      return;
    }

    setIsSubmitting(true);
    try {
      const results = await Promise.allSettled(
        sourceIds.map((sourceId) =>
          mode === "element"
            ? elementsApi.create(emitterId, sourceId, {
                element_type: elementType,
                variant,
                label: label || undefined,
                details: details || undefined,
                value_min: usesStagger ? undefined : Number(valueMin),
                value_max: usesStagger ? undefined : Number(valueMax),
                jitter_min: elementType === "pri" && !usesStagger && jitterMin ? Number(jitterMin) : undefined,
                jitter_max: elementType === "pri" && !usesStagger && jitterMax ? Number(jitterMax) : undefined,
                stagger_values: usesStagger
                  ? staggerValues
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .map(Number)
                  : undefined,
              })
            : parameterSequencesApi.create(emitterId, sourceId, {
                label: seqLabel || undefined,
                steps: steps.map((s) => ({
                  order: s.order,
                  rf_mhz: s.rf_mhz ?? undefined,
                  pw_us: s.pw_us ?? undefined,
                  pri_us: s.pri_us ?? undefined,
                  scan_value: s.scan_value ?? undefined,
                  dwell_s: s.dwell_s ?? undefined,
                })),
              }),
        ),
      );

      const failed: Outcome[] = [];
      results.forEach((result, i) => {
        if (result.status === "rejected") {
          const err = result.reason;
          failed.push({
            sourceId: sourceIds[i],
            sourceName: sourceNameById[sourceIds[i]] ?? sourceIds[i],
            error: err instanceof ApiRequestError ? err.message : "Failed to create",
          });
        }
      });

      for (const sourceId of sourceIds) {
        qc.invalidateQueries({ queryKey: elementsKey(emitterId, sourceId) });
        qc.invalidateQueries({ queryKey: parameterSequencesKey(emitterId, sourceId) });
      }

      if (failed.length === 0) {
        onDone();
      } else {
        setFailures(failed);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={`Batch Add to ${sourceIds.length} Source${sourceIds.length === 1 ? "" : "s"}`} onClose={onClose} wide>
      <form className="batch-edit-form" onSubmit={handleSubmit}>
        <p className="hint-text">
          Adds a new Element or Sequence to every one of the {sourceIds.length} selected Source(s). Each
          Source is independent — one failing doesn't stop the others.
        </p>

        <div className="edit-actions">
          <button
            type="button"
            className={mode === "element" ? "" : "icon-button"}
            onClick={() => setMode("element")}
          >
            Element
          </button>
          <button
            type="button"
            className={mode === "sequence" ? "" : "icon-button"}
            onClick={() => setMode("sequence")}
          >
            Sequence
          </button>
        </div>

        {mode === "element" ? (
          <div className="batch-edit-section">
            <div className="batch-edit-grid batch-edit-grid-3">
              <label>
                Type
                <select value={elementType} onChange={(e) => setElementType(e.target.value as ElementType)}>
                  {ELEMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Variant
                <select value={variant} onChange={(e) => setVariant(e.target.value as ElementVariant)}>
                  <option value="typical">typical</option>
                  <option value="discrete">discrete</option>
                  <option value="most_probable">most-probable</option>
                  <option value="extreme">extreme</option>
                  <option value="intercept">intercept</option>
                  <option value="analysis">analysis</option>
                  <option value="other">other</option>
                </select>
              </label>
              <label>
                Label (optional)
                <input value={label} onChange={(e) => setLabel(e.target.value)} />
              </label>
            </div>

            {elementType === "pri" && (
              <div className="batch-edit-grid batch-edit-grid-2">
                <label>
                  PRI shape
                  <select value={priShape} onChange={(e) => setPriShape(e.target.value as "range" | "stagger")}>
                    <option value="range">Fixed-style range</option>
                    <option value="stagger">Stagger sequence</option>
                  </select>
                </label>
              </div>
            )}

            {(elementType !== "pri" || priShape === "range") && (
              <div className="batch-edit-grid batch-edit-grid-4">
                <label>
                  Min
                  <input type="number" step="any" value={valueMin} onChange={(e) => setValueMin(e.target.value)} required />
                </label>
                <label>
                  Max
                  <input type="number" step="any" value={valueMax} onChange={(e) => setValueMax(e.target.value)} required />
                </label>
                {elementType === "pri" && (
                  <>
                    <label>
                      Jitter min
                      <input type="number" step="any" value={jitterMin} onChange={(e) => setJitterMin(e.target.value)} />
                    </label>
                    <label>
                      Jitter max
                      <input type="number" step="any" value={jitterMax} onChange={(e) => setJitterMax(e.target.value)} />
                    </label>
                  </>
                )}
              </div>
            )}
            {elementType === "pri" && priShape === "stagger" && (
              <div className="batch-edit-grid batch-edit-grid-2">
                <label>
                  Stagger values (comma-separated)
                  <input
                    placeholder="800, 850, 900, 780"
                    value={staggerValues}
                    onChange={(e) => setStaggerValues(e.target.value)}
                    required
                  />
                </label>
              </div>
            )}
            <label>
              {variant === "analysis" ? "Notes (required — how was this derived?)" : "Notes"}
              <input
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                required={variant === "analysis"}
                title={variant === "analysis" ? "The 'analysis' variant requires a note explaining how this value was derived" : undefined}
              />
            </label>
          </div>
        ) : (
          <div className="batch-edit-section">
            <div className="batch-edit-grid batch-edit-grid-3">
              <label>
                Sequence label
                <input value={seqLabel} onChange={(e) => setSeqLabel(e.target.value)} />
              </label>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: "3.5rem" }}>Order</th>
                  <th>RF (MHz)</th>
                  <th>PRI (µs)</th>
                  <th>PW (µs)</th>
                  <th>Dwell (pulses)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {steps.map((step, index) => (
                  <tr key={index}>
                    <td>{step.order + 1}</td>
                    <td>
                      <input
                        type="number"
                        step="any"
                        value={step.rf_mhz ?? ""}
                        onChange={(e) => updateStep(index, "rf_mhz", e.target.value ? Number(e.target.value) : null)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="any"
                        value={step.pri_us ?? ""}
                        onChange={(e) => updateStep(index, "pri_us", e.target.value ? Number(e.target.value) : null)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="any"
                        value={step.pw_us ?? ""}
                        onChange={(e) => updateStep(index, "pw_us", e.target.value ? Number(e.target.value) : null)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="any"
                        value={step.dwell_s ?? ""}
                        onChange={(e) => updateStep(index, "dwell_s", e.target.value ? Number(e.target.value) : null)}
                      />
                    </td>
                    <td>
                      <button type="button" className="link-button link-button-danger" onClick={() => removeStep(index)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="icon-button" onClick={addStep}>
              + Add Step
            </button>
          </div>
        )}

        <div className="batch-edit-actions">
          <button type="button" className="icon-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={isSubmitting}>
            Batch Add to {sourceIds.length} Source{sourceIds.length === 1 ? "" : "s"}
          </button>
        </div>

        {genericError && <div className="error-text">{genericError}</div>}
        {failures && failures.length > 0 && (
          <div className="error-text">
            <p>
              Added to {sourceIds.length - failures.length} of {sourceIds.length} Source(s) — {failures.length} failed:
            </p>
            <ul>
              {failures.map((f) => (
                <li key={f.sourceId}>
                  <strong>{f.sourceName}</strong>: {f.error}
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>
    </Modal>
  );
}
