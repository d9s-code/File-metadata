import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Modal } from "../common/Modal";
import { elementsApi } from "../../api/elements";
import { parameterSequencesApi } from "../../api/parameterSequences";
import { elementOverviewKey, elementsKey } from "../../state/hooks/useElements";
import { parameterSequencesKey } from "../../state/hooks/useParameterSequences";
import { ApiRequestError } from "../../api/client";
import type { ElementType, ElementVariant } from "../../types/domain";

const ELEMENT_TYPES: ElementType[] = ["rf", "pri", "pw", "scan"];
const UNITS: Record<ElementType, string> = { rf: "MHz", pri: "µs", pw: "µs", scan: "s" };

/** What was typed in the values box: each entry a value ("9000") or a range
 * ("9000-9200", "9000–9200", "9000 to 9200"), separated by commas, semicolons,
 * spaces or new lines. Entries that aren't numbers come back as `bad`. */
export function parseValueList(text: string): { values: [number, number][]; bad: string[] } {
  const normalised = text
    .replace(/\s*(?:–|—|\.\.|\bto\b)\s*/gi, "-")
    .replace(/(\d)\s*-\s*(?=\d)/g, "$1-");
  const values: [number, number][] = [];
  const bad: string[] = [];
  for (const token of normalised.split(/[\s,;]+/).filter(Boolean)) {
    const m = /^(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?$/.exec(token);
    if (!m) {
      bad.push(token);
      continue;
    }
    const a = Number(m[1]);
    const b = m[2] != null ? Number(m[2]) : a;
    values.push([Math.min(a, b), Math.max(a, b)]);
  }
  return { values, bad };
}

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
  /** The Sources ticked to start with (those selected in the table). */
  sourceIds: string[];
  /** Every Source of the Emitter, to pick from. */
  sourceNameById: Record<string, string>;
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"element" | "sequence">("element");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(sourceIds));
  const allSourceIds = Object.keys(sourceNameById).sort((a, b) =>
    sourceNameById[a].localeCompare(sourceNameById[b], undefined, { numeric: true }),
  );
  const targets = allSourceIds.filter((id) => picked.has(id));
  function togglePicked(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failures, setFailures] = useState<Outcome[] | null>(null);
  const [genericError, setGenericError] = useState<string | null>(null);

  // Element tab fields — mirrors ElementForm in ElementsPanel.tsx
  const [elementType, setElementType] = useState<ElementType>("rf");
  const [variant, setVariant] = useState<ElementVariant>("typical");
  const [priShape, setPriShape] = useState<"range" | "stagger">("range");
  const [valuesText, setValuesText] = useState("");
  const [delta, setDelta] = useState("");
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
  const parsed = parseValueList(valuesText);

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

    if (targets.length === 0) {
      setGenericError("Tick at least one Source.");
      return;
    }
    if (mode === "element" && variant === "analysis" && !details.trim()) {
      setGenericError("Selecting the 'analysis' variant requires a note in Notes.");
      return;
    }
    if (mode === "element" && !usesStagger && (parsed.bad.length > 0 || parsed.values.length === 0)) {
      setGenericError(
        parsed.bad.length > 0
          ? `Not a value or range: ${parsed.bad.join(", ")}`
          : "Type one or more values, e.g. 9000, 9100-9200, 9300.",
      );
      return;
    }

    if (mode === "element") {
      // All of it in one go: every Element to every ticked Source, or nothing.
      const common = {
        element_type: elementType,
        variant,
        label: label || undefined,
        details: details || undefined,
        delta: delta.trim() ? Number(delta) : undefined,
      };
      const elements = usesStagger
        ? [
            {
              ...common,
              stagger_values: staggerValues
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean)
                .map(Number),
            },
          ]
        : parsed.values.map(([lo, hi]) => ({
            ...common,
            value_min: lo,
            value_max: hi,
            jitter_min: elementType === "pri" && jitterMin ? Number(jitterMin) : undefined,
            jitter_max: elementType === "pri" && jitterMax ? Number(jitterMax) : undefined,
          }));
      setIsSubmitting(true);
      try {
        await elementsApi.batch(emitterId, targets, elements);
        for (const sourceId of targets) qc.invalidateQueries({ queryKey: elementsKey(emitterId, sourceId) });
        qc.invalidateQueries({ queryKey: elementOverviewKey(emitterId) });
        onDone();
      } catch (err) {
        setGenericError(err instanceof ApiRequestError ? err.message : "Couldn't add the Elements — nothing was added.");
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    setIsSubmitting(true);
    try {
      const results = await Promise.allSettled(
        targets.map((sourceId) =>
          parameterSequencesApi.create(emitterId, sourceId, {
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
            sourceId: targets[i],
            sourceName: sourceNameById[targets[i]] ?? targets[i],
            error: err instanceof ApiRequestError ? err.message : "Failed to create",
          });
        }
      });

      for (const sourceId of targets) qc.invalidateQueries({ queryKey: parameterSequencesKey(emitterId, sourceId) });

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
    <Modal title="Batch add to Sources" onClose={onClose} wide>
      <form className="batch-edit-form" onSubmit={handleSubmit}>
        <fieldset className="batch-sources">
          <legend>
            To {targets.length} of {allSourceIds.length} Source{allSourceIds.length === 1 ? "" : "s"}{" "}
            <button type="button" className="link-button" onClick={() => setPicked(new Set(allSourceIds))}>
              All
            </button>{" "}
            <button type="button" className="link-button" onClick={() => setPicked(new Set())}>
              None
            </button>
          </legend>
          {allSourceIds.map((id) => (
            <label key={id} className="inline-label">
              <input type="checkbox" checked={picked.has(id)} onChange={() => togglePicked(id)} />
              {sourceNameById[id]}
            </label>
          ))}
        </fieldset>

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
              <>
                <label>
                  {elementType.toUpperCase()} values ({UNITS[elementType]}) — each its own Element
                  <textarea
                    rows={2}
                    autoFocus
                    placeholder="9000, 9100-9200, 9300"
                    value={valuesText}
                    onChange={(e) => setValuesText(e.target.value)}
                    aria-invalid={parsed.bad.length > 0 || undefined}
                  />
                </label>
                <p className={parsed.bad.length ? "error-text" : "hint-text"}>
                  {parsed.bad.length > 0
                    ? `Not a value or range: ${parsed.bad.join(", ")} — use "." for decimals.`
                    : parsed.values.length > 0
                      ? `${parsed.values.length} Element${parsed.values.length === 1 ? "" : "s"}: ${parsed.values
                          .map(([lo, hi]) => (lo === hi ? `${lo}` : `${lo}–${hi}`))
                          .join(" · ")} ${UNITS[elementType]} × ${targets.length} Source${targets.length === 1 ? "" : "s"} = ${
                          parsed.values.length * targets.length
                        } Elements`
                      : 'Separate values with commas, spaces or new lines; a range as 9100-9200. Use "." for decimals.'}
                </p>
              </>
            )}
            <div className="batch-edit-grid batch-edit-grid-4">
                <label>
                  ± delta (optional)
                  <input type="number" step="any" min="0" value={delta} onChange={(e) => setDelta(e.target.value)} required={usesStagger} />
                </label>
                {elementType === "pri" && !usesStagger && (
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
            <div className="batch-seq-wrap">
            <table className="data-table batch-seq-table">
              <thead>
                <tr>
                  <th style={{ width: "2.5rem" }}>#</th>
                  <th>RF (MHz)</th>
                  <th>PRI (µs)</th>
                  <th>PW (µs)</th>
                  <th>Dwell (pulses)</th>
                  <th style={{ width: "4.5rem" }}></th>
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
            </div>
            <button type="button" className="icon-button" onClick={addStep}>
              + Add step
            </button>
          </div>
        )}

        <div className="batch-edit-actions">
          <button type="button" className="icon-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={isSubmitting || targets.length === 0}>
            {mode === "element" && !usesStagger && parsed.values.length > 0
              ? `Add ${parsed.values.length * targets.length} Element${parsed.values.length * targets.length === 1 ? "" : "s"}`
              : `Batch add to ${targets.length} Source${targets.length === 1 ? "" : "s"}`}
          </button>
        </div>

        {genericError && <div className="error-text">{genericError}</div>}
        {failures && failures.length > 0 && (
          <div className="error-text">
            <p>
              Added to {targets.length - failures.length} of {targets.length} Source(s) — {failures.length} failed:
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
