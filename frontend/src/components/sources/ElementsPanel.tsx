import { useRef, useState, type FormEvent } from "react";
import { frameTimeFromText } from "../common/frameTime";
import type { ElementType, ElementVariant, ModeElement } from "../../types/domain";
import { useCreateElement, useDeleteElement, useElements } from "../../state/hooks/useElements";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";
import { FrametimeBadge } from "./FrametimeBadge";
import { ApiRequestError } from "../../api/client";
import { useHasRole } from "../../auth/RequireAuth";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { groupElements, type MergedElementGroup } from "./elementMerge";
import { VARIANT_ORDER, VariantTag } from "./elementDisplay";
import { useSessionState } from "../common/useSessionState";
import { useModeDefaults } from "../../state/hooks/useDwells";

const ELEMENT_TYPES: ElementType[] = ["rf", "pri", "pw", "scan"];
const TYPE_NAME: Record<ElementType, string> = { rf: "RF", pri: "PRI", pw: "PW", scan: "Scan" };
export const ELEMENT_UNIT: Record<ElementType, string> = { rf: "MHz", pri: "µs", pw: "µs", scan: "s" };
const VARIANTS: { value: ElementVariant; label: string }[] = [
  { value: "typical", label: "typical" },
  { value: "discrete", label: "discrete" },
  { value: "most_probable", label: "most-probable" },
  { value: "extreme", label: "extreme" },
  { value: "intercept", label: "intercept" },
  { value: "analysis", label: "analysis" },
  { value: "other", label: "other" },
];

type ElementOrder = "value" | "value-desc" | "label";

/** Typical first, then the other variants, each low to high — or as picked. */
function orderGroups(groups: MergedElementGroup[], order: ElementOrder): MergedElementGroup[] {
  const variantRank = (g: MergedElementGroup) => (g.members[0].variant ? (VARIANT_ORDER[g.members[0].variant] ?? 99) : 99);
  const low = (g: MergedElementGroup) => g.value_min ?? g.stagger_values?.[0] ?? Infinity;
  const label = (g: MergedElementGroup) => g.members.find((m) => m.label)?.label ?? "￿";
  return [...groups].sort((a, b) => {
    if (order === "label") return label(a).localeCompare(label(b), undefined, { numeric: true }) || low(a) - low(b);
    if (order === "value-desc") return low(b) - low(a);
    return variantRank(a) - variantRank(b) || low(a) - low(b);
  });
}

function rangeText(min: number | null, max: number | null): string {
  if (min == null && max == null) return "—";
  return min === max || max == null ? `${min}` : `${min}–${max}`;
}

/** The add bar under the lists: one row, its type picked by the segmented
 * control or by a list's "+". */
function ElementForm({
  emitterId,
  sourceId,
  canEdit,
  elementType,
  onType,
  minRef,
}: {
  emitterId: string;
  sourceId: string;
  canEdit: boolean;
  elementType: ElementType;
  onType: (t: ElementType) => void;
  minRef: React.RefObject<HTMLInputElement | null>;
}) {
  const createElement = useCreateElement(emitterId, sourceId);
  const [variant, setVariant] = useState<ElementVariant>("typical");
  const [priShape, setPriShape] = useState<"range" | "stagger">("range");
  const [valueMin, setValueMin] = useState("");
  const [valueMax, setValueMax] = useState("");
  const [jitterMin, setJitterMin] = useState("0");
  const [jitterMax, setJitterMax] = useState("1");
  const [staggerValues, setStaggerValues] = useState("");
  // A stagger's frame-time delta; empty uses the Admins' default.
  const [frameDelta, setFrameDelta] = useState("");
  const { defaults } = useModeDefaults();
  const [label, setLabel] = useState("");
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const usesStagger = elementType === "pri" && priShape === "stagger";
  const suggestedFrameTimeUs = frameTimeFromText(staggerValues);
  const unit = ELEMENT_UNIT[elementType];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setAdded(null);
    try {
      await createElement.mutateAsync({
        element_type: elementType,
        variant,
        label: label || undefined,
        details: details || undefined,
        delta: usesStagger ? Number(frameDelta.trim() === "" ? defaults.frame_time_delta_us : frameDelta) : undefined,
        value_min: usesStagger ? undefined : Number(valueMin),
        // A single value is a range of one.
        value_max: usesStagger ? undefined : Number(valueMax.trim() === "" ? valueMin : valueMax),
        jitter_min: elementType === "pri" && !usesStagger && jitterMin ? Number(jitterMin) : undefined,
        jitter_max: elementType === "pri" && !usesStagger && jitterMax ? Number(jitterMax) : undefined,
        stagger_values: usesStagger
          ? staggerValues
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
              .map(Number)
          : undefined,
      });
      setAdded(`Added ${TYPE_NAME[elementType]} ${usesStagger ? staggerValues : rangeText(Number(valueMin), Number(valueMax || valueMin))} ${unit}`);
      // Values clear for the next one; type, variant and shape stay.
      setValueMin("");
      setValueMax("");
      setStaggerValues("");
      setLabel("");
      setDetails("");
      minRef.current?.focus();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to create element");
    }
  }

  return (
    <form className="el-add" onSubmit={handleSubmit} aria-label="Add an Element">
      <div className="seg-toggle" role="radiogroup" aria-label="Element type">
        {ELEMENT_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={elementType === t}
            className={elementType === t ? "on" : undefined}
            onClick={() => onType(t)}
          >
            {TYPE_NAME[t]}
          </button>
        ))}
      </div>
      <select value={variant} onChange={(e) => setVariant(e.target.value as ElementVariant)} aria-label="Variant">
        {VARIANTS.map((v) => (
          <option key={v.value} value={v.value}>
            {v.label}
          </option>
        ))}
      </select>
      {elementType === "pri" && (
        <select value={priShape} onChange={(e) => setPriShape(e.target.value as "range" | "stagger")} aria-label="PRI shape">
          <option value="range">Range</option>
          <option value="stagger">Stagger steps</option>
        </select>
      )}
      <input className="el-add-label" placeholder="Label" aria-label="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
      {usesStagger ? (
        <span className="el-add-values">
          <input
            ref={minRef}
            className="el-add-steps"
            placeholder="800, 850, 900, 780"
            aria-label="Stagger steps (µs)"
            value={staggerValues}
            onChange={(e) => setStaggerValues(e.target.value)}
            required
          />
          <span className="hint-text">µs</span>
          {suggestedFrameTimeUs > 0 && <span className="hint-text">frame {suggestedFrameTimeUs} µs</span>}
          <span className="hint-text">±</span>
          <input
            className="el-add-frame"
            type="number"
            step="any"
            min="0"
            placeholder={String(defaults.frame_time_delta_us)}
            aria-label="Frame time delta (± µs)"
            title="Frame time delta (± µs) — empty uses the default"
            value={frameDelta}
            onChange={(e) => setFrameDelta(e.target.value)}
          />
        </span>
      ) : (
        <span className="el-add-values">
          <input
            ref={minRef}
            placeholder="min"
            aria-label={`${TYPE_NAME[elementType]} min (${unit})`}
            type="number"
            step="any"
            value={valueMin}
            onChange={(e) => setValueMin(e.target.value)}
            required
          />
          <span aria-hidden="true">–</span>
          <input
            placeholder="max"
            aria-label={`${TYPE_NAME[elementType]} max (${unit})`}
            title="Leave empty for a single value"
            type="number"
            step="any"
            value={valueMax}
            onChange={(e) => setValueMax(e.target.value)}
          />
          <span className="hint-text">{unit}</span>
        </span>
      )}
      {elementType === "pri" && !usesStagger && (
        <span className="el-add-values" title="Jitter (µs)">
          <span className="hint-text">jitter</span>
          <input type="number" step="any" aria-label="Jitter min (µs)" value={jitterMin} onChange={(e) => setJitterMin(e.target.value)} />
          <span aria-hidden="true">–</span>
          <input type="number" step="any" aria-label="Jitter max (µs)" value={jitterMax} onChange={(e) => setJitterMax(e.target.value)} />
        </span>
      )}
      <input
        className="el-add-notes"
        placeholder={variant === "analysis" ? "Notes (required: how was it derived?)" : "Notes"}
        aria-label="Notes"
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        required={variant === "analysis"}
        title={variant === "analysis" ? "The 'analysis' variant needs a note explaining how this value was derived" : undefined}
      />
      <button type="submit" className="button primary small" disabled={createElement.isPending || !canEdit}>
        Add {TYPE_NAME[elementType]}
      </button>
      {error && <span className="error-text">{error}</span>}
      {!error && added && <span className="hint-text" role="status">{added}</span>}
    </form>
  );
}

/** One type's Elements as a list that fills its column's height. Elements
 * with the same values share a row, each with its own variant, label and ✕. */
function ElementColumn({
  type,
  groups,
  canEdit,
  canWrite,
  onAdd,
  onDelete,
}: {
  type: ElementType;
  groups: MergedElementGroup[];
  canEdit: boolean;
  canWrite: boolean;
  onAdd: () => void;
  onDelete: (el: ModeElement) => void;
}) {
  const unit = ELEMENT_UNIT[type];
  return (
    <section className="el-col" aria-label={`${TYPE_NAME[type]} Elements`}>
      <header className="el-col-head">
        <strong>{TYPE_NAME[type]}</strong>
        <span className="hint-text">
          {groups.length} · {unit}
        </span>
        {canWrite && (
          <button
            type="button"
            className="icon-button el-col-add"
            onClick={onAdd}
            disabled={!canEdit}
            title={canEdit ? `Add a ${TYPE_NAME[type]} Element` : "Start editing this Emitter first"}
            aria-label={`Add a ${TYPE_NAME[type]} Element`}
          >
            +
          </button>
        )}
      </header>
      {groups.length === 0 ? (
        <p className="hint-text el-col-empty">None yet.</p>
      ) : (
        <ul className="el-list">
          {groups.map((g) => {
            const first = g.members[0];
            const extras: string[] = [];
            if (first.jitter_min != null) extras.push(`jitter ${rangeText(first.jitter_min, first.jitter_max)}`);
            if (first.delta != null && first.delta !== 0) extras.push(`±${first.delta}`);
            return (
              <li key={g.representativeId} className="el-row">
                <div className="el-row-value">
                  {g.stagger_values ? (
                    <>
                      <span className="figure">[{g.stagger_values.join(", ")}]</span>
                      <FrametimeBadge staggerValues={g.stagger_values} />
                    </>
                  ) : (
                    <span className="figure">{rangeText(g.value_min, g.value_max)}</span>
                  )}
                  {extras.length > 0 && <span className="hint-text">{extras.join(" · ")}</span>}
                </div>
                {g.members.map((el) => (
                  <div key={el.id} className="el-member">
                    <VariantTag variant={el.variant} />
                    <span className={el.label ? "el-member-label" : "el-member-label muted"}>{el.label || "unnamed"}</span>
                    {el.details && (
                      <span className="el-member-notes" title={el.details}>
                        {el.details}
                      </span>
                    )}
                    {canWrite && (
                      <button
                        type="button"
                        className="el-delete"
                        disabled={!canEdit}
                        title={canEdit ? "Delete this Element" : "Start editing this Emitter first"}
                        aria-label={`Delete ${TYPE_NAME[type]} ${el.label || rangeText(g.value_min, g.value_max)}`}
                        onClick={() => onDelete(el)}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** A Source's Elements: RF, PRI, PW and Scan side by side, each filling the
 * height and scrolling on its own, with one add bar under them. */
export function ElementsPanel({ emitterId, sourceId }: { emitterId: string; sourceId: string }) {
  const { data: elements } = useElements(emitterId, sourceId);
  const deleteElement = useDeleteElement(emitterId, sourceId);
  const { data: emitter } = useEmitter(emitterId);
  const { canEdit } = useEmitterCheckoutState(emitter);
  const canWrite = useHasRole("editor");
  const { confirmDelete, dialog } = useConfirmDialog();
  const [order, setOrder] = useSessionState<ElementOrder>("sourceElements.order", "value");
  const [addType, setAddType] = useState<ElementType>("rf");
  const minRef = useRef<HTMLInputElement>(null);

  async function handleDelete(el: ModeElement) {
    if (await confirmDelete("Delete this Element? Modes already generated from it are not affected.")) {
      await deleteElement.mutateAsync(el.id);
    }
  }

  function startAdding(t: ElementType) {
    setAddType(t);
    // After the form has re-rendered for the type.
    requestAnimationFrame(() => minRef.current?.focus());
  }

  return (
    <div className="el-panel">
      <div className="el-toolbar">
        <span className="hint-text">{(elements ?? []).length} Elements</span>
        <label className="el-order">
          <span className="hint-text">Order</span>
          <select value={order} onChange={(e) => setOrder(e.target.value as ElementOrder)} aria-label="Order the Elements">
            <option value="value">Typical first, low → high</option>
            <option value="value-desc">High → low</option>
            <option value="label">By label</option>
          </select>
        </label>
      </div>
      <div className="el-board">
        {ELEMENT_TYPES.map((t) => (
          <ElementColumn
            key={t}
            type={t}
            groups={orderGroups(groupElements((elements ?? []).filter((e) => e.element_type === t)), order)}
            canEdit={canEdit}
            canWrite={canWrite}
            onAdd={() => startAdding(t)}
            onDelete={(el) => void handleDelete(el)}
          />
        ))}
      </div>
      {canWrite && (
        <fieldset className="edit-lock el-add-wrap" disabled={!canEdit} title={canEdit ? undefined : "Start editing this Emitter first"}>
          <ElementForm
            emitterId={emitterId}
            sourceId={sourceId}
            canEdit={canEdit}
            elementType={addType}
            onType={setAddType}
            minRef={minRef}
          />
        </fieldset>
      )}
      {dialog}
    </div>
  );
}
