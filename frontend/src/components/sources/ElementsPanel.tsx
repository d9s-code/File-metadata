import { useState, type FormEvent } from "react";
import type { ElementType } from "../../types/domain";
import { useCreateElement, useDeleteElement, useElements } from "../../state/hooks/useElements";
import { FrametimeBadge } from "./FrametimeBadge";
import { ApiRequestError } from "../../api/client";
import { RequireRole } from "../../auth/RequireAuth";
import { useConfirmDialog } from "../common/ConfirmDialog";

const ELEMENT_TYPES: ElementType[] = ["rf", "pw", "pri", "scan"];

function ElementForm({ emitterId, sourceId }: { emitterId: string; sourceId: string }) {
  const createElement = useCreateElement(emitterId, sourceId);
  const [elementType, setElementType] = useState<ElementType>("rf");
  const [priShape, setPriShape] = useState<"range" | "stagger">("range");
  const [valueMin, setValueMin] = useState("");
  const [valueMax, setValueMax] = useState("");
  const [jitterMin, setJitterMin] = useState("");
  const [jitterMax, setJitterMax] = useState("");
  const [delta, setDelta] = useState("");
  const [staggerValues, setStaggerValues] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const usesStagger = elementType === "pri" && priShape === "stagger";
  const suggestedFrameTimeUs = staggerValues
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .reduce((sum, v) => (Number.isFinite(v) ? sum + v : sum), 0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createElement.mutateAsync({
        element_type: elementType,
        label: label || undefined,
        value_min: usesStagger ? undefined : Number(valueMin),
        value_max: usesStagger ? undefined : Number(valueMax),
        jitter_min: elementType === "pri" && !usesStagger && jitterMin ? Number(jitterMin) : undefined,
        jitter_max: elementType === "pri" && !usesStagger && jitterMax ? Number(jitterMax) : undefined,
        delta: delta ? Number(delta) : undefined,
        stagger_values: usesStagger
          ? staggerValues
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
              .map(Number)
          : undefined,
      });
      setValueMin("");
      setValueMax("");
      setJitterMin("");
      setJitterMax("");
      setDelta("");
      setStaggerValues("");
      setLabel("");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to create element");
    }
  }

  return (
    <form className="card inline-form" onSubmit={handleSubmit}>
      <select value={elementType} onChange={(e) => setElementType(e.target.value as ElementType)}>
        {ELEMENT_TYPES.map((t) => (
          <option key={t} value={t}>
            {t.toUpperCase()}
          </option>
        ))}
      </select>
      {elementType === "pri" && (
        <select value={priShape} onChange={(e) => setPriShape(e.target.value as "range" | "stagger")}>
          <option value="range">Fixed-style range</option>
          <option value="stagger">Stagger sequence</option>
        </select>
      )}
      <input placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />

      {(elementType !== "pri" || priShape === "range") && (
        <>
          <input placeholder="min" type="number" step="any" value={valueMin} onChange={(e) => setValueMin(e.target.value)} required />
          <input placeholder="max" type="number" step="any" value={valueMax} onChange={(e) => setValueMax(e.target.value)} required />
          <input
            placeholder="delta (±, optional)"
            type="number"
            step="any"
            min="0"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            title="Symmetric tolerance margin applied to the raw value to derive the engineered value used when generating Modes"
          />
        </>
      )}
      {elementType === "pri" && priShape === "range" && (
        <>
          <input placeholder="jitter min" type="number" step="any" value={jitterMin} onChange={(e) => setJitterMin(e.target.value)} />
          <input placeholder="jitter max" type="number" step="any" value={jitterMax} onChange={(e) => setJitterMax(e.target.value)} />
        </>
      )}
      {elementType === "pri" && priShape === "stagger" && (
        <>
          <input
            placeholder="800, 850, 900, 780"
            value={staggerValues}
            onChange={(e) => setStaggerValues(e.target.value)}
            required
          />
          <input
            placeholder="frame time delta (±µs)"
            type="number"
            step="any"
            min="0"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            title="Symmetric tolerance margin applied to the suggested frame time (sum of the stagger sequence) to derive the engineered min/max — required for a stagger PRI element"
            required
          />
          {suggestedFrameTimeUs > 0 && (
            <span className="hint-text">Suggested frame time: {suggestedFrameTimeUs} µs</span>
          )}
        </>
      )}
      <button type="submit" disabled={createElement.isPending}>
        Add Element
      </button>
      {error && <div className="error-text">{error}</div>}
    </form>
  );
}

export function ElementsPanel({ emitterId, sourceId }: { emitterId: string; sourceId: string }) {
  const { data: elements } = useElements(emitterId, sourceId);
  const deleteElement = useDeleteElement(emitterId, sourceId);
  const { confirmDelete, dialog } = useConfirmDialog();

  async function handleDelete(elementId: string) {
    if (await confirmDelete("Delete this element? Modes already generated from it are not affected.")) {
      await deleteElement.mutateAsync(elementId);
    }
  }

  const grouped = ELEMENT_TYPES.map((t) => ({
    type: t,
    items: (elements ?? []).filter((e) => e.element_type === t),
  }));

  return (
    <div>
      {grouped.map(({ type, items }) => (
        <div key={type} className="element-group">
          <h5>{type.toUpperCase()} elements</h5>
          {items.length === 0 && <p className="hint-text">None yet.</p>}
          <ul className="element-list">
            {items.map((el) => (
              <li key={el.id}>
                {el.variant && <span className="hint-text">[{el.variant.replace("_", " ")}] </span>}
                {el.label && <strong>{el.label}: </strong>}
                {el.stagger_values ? (
                  <>
                    [{el.stagger_values.join(", ")}] µs <FrametimeBadge staggerValues={el.stagger_values} />
                    {el.delta != null && (
                      <span className="hint-text">
                        {" "}
                        · engineered frame time: {el.engineered_frame_time_min_us}–{el.engineered_frame_time_max_us} µs
                        (±{el.delta})
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    {el.value_min}–{el.value_max}
                    {el.jitter_min != null && ` (jitter ${el.jitter_min}–${el.jitter_max})`}
                    {el.delta != null && (
                      <span className="hint-text">
                        {" "}
                        · raw · engineered: {el.engineered_min}–{el.engineered_max} (±{el.delta})
                      </span>
                    )}
                  </>
                )}
                <RequireRole minimum="editor">
                  <button className="link-button" onClick={() => void handleDelete(el.id)}>
                    Delete
                  </button>
                </RequireRole>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <RequireRole minimum="editor">
        <ElementForm emitterId={emitterId} sourceId={sourceId} />
      </RequireRole>
      {dialog}
    </div>
  );
}
