import { useState, type FormEvent } from "react";
import type { ElementType, ElementVariant } from "../../types/domain";
import { useCreateElement, useDeleteElement, useElements } from "../../state/hooks/useElements";
import { FrametimeBadge } from "./FrametimeBadge";
import { ApiRequestError } from "../../api/client";
import { RequireRole } from "../../auth/RequireAuth";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { SequenceForm } from "./SequenceForm";

const ELEMENT_TYPES: ElementType[] = ["rf", "pri", "pw", "scan"];

const VARIANT_STYLES: Record<string, { label: string; bg: string; fg: string; border: string }> = {
  typical: { label: "typical", bg: "var(--badge-blue-bg)", fg: "var(--badge-blue-fg)", border: "var(--badge-blue-fg)" },
  discrete: { label: "discrete", bg: "var(--badge-green-bg)", fg: "var(--badge-green-fg)", border: "var(--badge-green-fg)" },
  most_probable: { label: "most-probable", bg: "#7c2d12", fg: "#fed7aa", border: "#ea580c" },
  extreme: { label: "extreme", bg: "var(--badge-red-bg)", fg: "var(--badge-red-fg)", border: "var(--badge-red-fg)" },
  intercept: { label: "intercept", bg: "#0f766e", fg: "#ccfbf1", border: "#14b8a6" },
  other: { label: "other", bg: "#4b5563", fg: "#f3f4f6", border: "#374151" },
};

function ElementForm({ emitterId, sourceId }: { emitterId: string; sourceId: string }) {
  const createElement = useCreateElement(emitterId, sourceId);
  const [elementType, setElementType] = useState<ElementType>("rf");
  const [variant, setVariant] = useState<ElementVariant>("typical");
  const [priShape, setPriShape] = useState<"range" | "stagger">("range");
  const [valueMin, setValueMin] = useState("");
  const [valueMax, setValueMax] = useState("");
  const [jitterMin, setJitterMin] = useState("");
  const [jitterMax, setJitterMax] = useState("");
  const [staggerValues, setStaggerValues] = useState("");
  const [label, setLabel] = useState("");
  const [details, setDetails] = useState("");
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
      });
      setValueMin("");
      setValueMax("");
      setJitterMin("");
      setJitterMax("");
      setStaggerValues("");
      setLabel("");
      setDetails("");
      setVariant("typical");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to create element");
    }
  }

  return (
    <form className="card inline-form flex-wrap gap-2" onSubmit={handleSubmit}>
      <select value={elementType} onChange={(e) => setElementType(e.target.value as ElementType)}>
        {ELEMENT_TYPES.map((t) => (
          <option key={t} value={t}>
            {t.toUpperCase()}
          </option>
        ))}
      </select>
      <select value={variant} onChange={(e) => setVariant(e.target.value as ElementVariant)}>
        <option value="typical">typical</option>
        <option value="discrete">discrete</option>
        <option value="most_probable">most-probable</option>
        <option value="extreme">extreme</option>
        <option value="intercept">intercept</option>
        <option value="other">other</option>
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
          {suggestedFrameTimeUs > 0 && (
            <span className="hint-text">Suggested frame time: {suggestedFrameTimeUs} µs</span>
          )}
        </>
      )}
      <input placeholder="Notes" value={details} onChange={(e) => setDetails(e.target.value)} />
      <button type="submit" disabled={createElement.isPending}>
        Add Element
      </button>
      {error && <div className="error-text">{error}</div>}
    </form>
  );
}

export function ElementsPanel({ 
  emitterId, 
  sourceId, 
  isCollapsed: isPanelCollapsed = false 
}: { 
  emitterId: string; 
  sourceId: string; 
  isCollapsed?: boolean; 
}) {
  const { data: elements } = useElements(emitterId, sourceId);
  const deleteElement = useDeleteElement(emitterId, sourceId);
  const { confirmDelete, dialog } = useConfirmDialog();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [hoveredGroups, setHoveredGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (type: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const handleMouseEnter = (type: string) => {
    setHoveredGroups((prev) => new Set(prev).add(type));
  };

  const handleMouseLeave = (type: string) => {
    setHoveredGroups((prev) => {
      const next = new Set(prev);
      next.delete(type);
      return next;
    });
  };

  async function handleDelete(elementId: string) {
    if (await confirmDelete("Delete this element? Modes already generated from it are not affected.")) {
      await deleteElement.mutateAsync(elementId);
    }
  }

  const VARIANT_ORDER: Record<string, number> = {
    typical: 0,
    discrete: 1,
    most_probable: 2,
    extreme: 3,
  };

  const grouped = ELEMENT_TYPES.map((t) => ({
    type: t,
    items: (elements ?? [])
      .filter((e) => e.element_type === t)
      .sort((a, b) => {
        const orderA = a.variant ? VARIANT_ORDER[a.variant] ?? 99 : 99;
        const orderB = b.variant ? VARIANT_ORDER[b.variant] ?? 99 : 99;
        return orderA - orderB;
      }),
  }));

  const [creationMode, setCreationMode] = useState<"element" | "sequence">("element");

  return (
    <div className="space-y-4">
      {!isPanelCollapsed && (
        <>
          <div className="cartesian-columns grid grid-cols-4 gap-4 my-3 overflow-x-auto pb-4">
            {grouped.map(({ type, items }) => {
              const isCollapsed = collapsedGroups.has(type);
              return (
                <div key={type} className="element-group flex flex-col">
                  <div 
                    className="flex items-center gap-2 cursor-pointer transition-colors group w-full py-1 px-3 rounded-full"
                    onClick={() => toggleGroup(type)}
                    onMouseEnter={() => handleMouseEnter(type)}
                    onMouseLeave={() => handleMouseLeave(type)}
                    style={{ 
                      cursor: 'pointer', 
                      display: 'flex', 
                      flexDirection: 'row',
                      backgroundColor: hoveredGroups.has(type) ? (document.documentElement.getAttribute('data-theme') === 'dark' ? 'rgba(110, 168, 254, 0.25)' : 'rgba(110, 168, 254, 0.2)') : 'transparent'
                    }}
                  >
                    <h5 className={`uppercase text-sm font-semibold pointer-events-none ${hoveredGroups.has(type) ? 'text-blue-700 dark:text-blue-300' : 'text-gray-500'}`}>
                      {type.toUpperCase()} elements
                    </h5>
                    <svg 
                      className={`transition-transform duration-200 pointer-events-none ${isCollapsed ? "-rotate-90" : ""}`} 
                      style={{ width: '12px', height: '12px' }}
                      fill="none" 
                      viewBox="0 0 24 24" 
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>

                  {!isCollapsed && (
                    <div className="mt-1">
                      {items.length === 0 ? (
                        <p className="hint-text">None yet.</p>
                      ) : (
                        <div className="overflow-x-auto border border-gray-200 rounded-lg">
                          <table className="w-full text-left border-collapse text-sm">
                            <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs uppercase font-medium">
                              <tr>
                                <th className="px-2 py-0 w-24">Variant</th>
                                <th className="px-2 py-0 w-48">Label</th>
                                <th className="px-2 py-0 w-64">Values</th>
                                <th className="px-2 py-0">Notes</th>
                                <th className="px-2 py-0 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {items.map((el) => (
                                <tr key={el.id} className="hover:bg-gray-50 transition-colors">
                                  <td className="px-2 py-0 align-middle">
                                    {el.variant ? (
                                      (() => {
                                        const rawVariant = el.variant.trim().toLowerCase();
                                        const variantKey = rawVariant.replace(/-/g, "_") as keyof typeof VARIANT_STYLES;
                                        const style = VARIANT_STYLES[variantKey] || { 
                                          label: rawVariant.replace(/_/g, " "), 
                                          bg: "#fef3c7", 
                                          fg: "#92400e", 
                                          border: "#fcd34d" 
                                        };
                                        return (
                                          <span 
                                            className="inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase"
                                            style={{ backgroundColor: style.bg, color: style.fg, borderColor: style.border }}
                                            title={el.variant}
                                          >
                                            {style.label}
                                          </span>
                                        );
                                      })()
                                    ) : (
                                      <span className="text-gray-400">—</span>
                                    )}
                                  </td>
                                  <td className="px-2 py-0 align-middle">
                                    {el.label ? <span className="font-bold">{el.label}</span> : <span className="text-gray-400 italic">unnamed</span>}
                                  </td>
                                  <td className="px-2 py-0 align-middle whitespace-nowrap">
                                    {el.stagger_values ? (
                                      <div className="flex items-center gap-2">
                                        <span className="font-mono">[{el.stagger_values.join(", ")}] µs</span>
                                        <FrametimeBadge staggerValues={el.stagger_values} />
                                      </div>
                                    ) : (
                                      <div className="font-mono">
                                        {el.value_min}–{el.value_max}
                                        {el.jitter_min != null && <span className="text-gray-500 text-xs"> (jitter {el.jitter_min}–{el.jitter_max})</span>}
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-2 py-0 align-middle text-xs text-gray-500">
                                    {el.details}
                                  </td>
                                  <td className="px-2 py-0 align-middle text-right">
                                    <RequireRole minimum="editor">
                                      <button className="text-red-600 hover:text-red-800 text-xs font-medium" onClick={() => void handleDelete(el.id)}>
                                        Delete
                                      </button>
                                    </RequireRole>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="pt-2 border-t border-gray-200">
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-lg" style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setCreationMode("element")}
                  className={`px-6 py-1 text-xs font-bold rounded-md transition-colors ${
                    creationMode === "element"
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  }`}
                >
                  Single Element
                </button>
                <button
                  type="button"
                  onClick={() => setCreationMode("sequence")}
                  className={`px-6 py-1 text-xs font-bold rounded-md transition-colors ${
                    creationMode === "sequence"
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  }`}
                >
                  Sequence
                </button>
              </div>
            </div>
            <RequireRole minimum="editor">
              {creationMode === "element" ? (
                <ElementForm emitterId={emitterId} sourceId={sourceId} />
              ) : (
                <SequenceForm emitterId={emitterId} sourceId={sourceId} />
              )}
            </RequireRole>
          </div>
        </>
      )}
      {dialog}
    </div>
  );
}
