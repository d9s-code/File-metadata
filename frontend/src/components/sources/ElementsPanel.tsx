import { useState, type FormEvent } from "react";
import type { ElementType, ElementVariant, ModeElement } from "../../types/domain";
import { useCreateElement, useDeleteElement, useElements } from "../../state/hooks/useElements";
import { FrametimeBadge } from "./FrametimeBadge";
import { ApiRequestError } from "../../api/client";
import { RequireRole } from "../../auth/RequireAuth";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { SequenceForm } from "./SequenceForm";
import { groupElements, type MergedElementGroup } from "./elementMerge";
import { SortableColumnHeader } from "../common/SortableColumnHeader";
import { useSortableTable } from "../common/useSortableTable";
import { compareNullable, compareStrings } from "../common/sortUtils";

type ElementSortKey = "label" | "value";

function compareGroups(a: MergedElementGroup, b: MergedElementGroup, key: ElementSortKey, dir: "asc" | "desc"): number {
  switch (key) {
    case "label":
      return compareStrings(a.members[0].label, b.members[0].label, dir);
    case "value":
      return compareNullable(a.value_min, b.value_min, dir);
  }
}

const ELEMENT_TYPES: ElementType[] = ["rf", "pri", "pw", "scan"];

const VARIANT_STYLES: Record<string, { label: string; bg: string; fg: string; border: string }> = {
  typical: { label: "typical", bg: "var(--badge-blue-bg)", fg: "var(--badge-blue-fg)", border: "var(--badge-blue-fg)" },
  discrete: { label: "discrete", bg: "var(--badge-green-bg)", fg: "var(--badge-green-fg)", border: "var(--badge-green-fg)" },
  most_probable: { label: "most-probable", bg: "#7c2d12", fg: "#fed7aa", border: "#ea580c" },
  extreme: { label: "extreme", bg: "var(--badge-red-bg)", fg: "var(--badge-red-fg)", border: "var(--badge-red-fg)" },
  intercept: { label: "intercept", bg: "#0f766e", fg: "#ccfbf1", border: "#14b8a6" },
  analysis: { label: "analysis", bg: "#4c1d95", fg: "#ddd6fe", border: "#7c3aed" },
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
        <option value="analysis">analysis</option>
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
      <input
        placeholder={variant === "analysis" ? "Notes (required — how was this derived?)" : "Notes"}
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        required={variant === "analysis"}
        title={variant === "analysis" ? "The 'analysis' variant requires a note explaining how this value was derived" : undefined}
      />
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

  const { sortKey, sortDir, onSort, onClear } = useSortableTable<MergedElementGroup, ElementSortKey>(
    [],
    compareGroups,
  );

  const grouped = ELEMENT_TYPES.map((t) => {
    const groups = groupElements((elements ?? []).filter((e) => e.element_type === t));
    const sorted = sortKey
      ? [...groups].sort((a, b) => compareGroups(a, b, sortKey, sortDir))
      : [...groups].sort((a, b) => {
          const orderA = a.members[0].variant ? VARIANT_ORDER[a.members[0].variant] ?? 99 : 99;
          const orderB = b.members[0].variant ? VARIANT_ORDER[b.members[0].variant] ?? 99 : 99;
          return orderA - orderB;
        });
    return { type: t, groups: sorted };
  });

  function renderVariantBadge(el: ModeElement) {
    if (!el.variant) return <span className="text-gray-400">—</span>;
    const rawVariant = el.variant.trim().toLowerCase();
    const variantKey = rawVariant.replace(/-/g, "_") as keyof typeof VARIANT_STYLES;
    const style = VARIANT_STYLES[variantKey] || {
      label: rawVariant.replace(/_/g, " "),
      bg: "#fef3c7",
      fg: "#92400e",
      border: "#fcd34d",
    };
    const meta: string[] = [];
    if (el.jitter_min != null) meta.push(`jitter ${el.jitter_min}–${el.jitter_max}`);
    if (el.delta != null) meta.push(`±${el.delta} delta`);
    return (
      <span
        style={{
          display: "inline-block",
          padding: "1px 6px",
          borderRadius: "4px",
          border: `1px solid ${style.border}`,
          fontSize: "10px",
          fontWeight: 700,
          textTransform: "uppercase",
          backgroundColor: style.bg,
          color: style.fg,
        }}
        title={meta.length ? `${el.variant} (${meta.join(", ")})` : el.variant}
      >
        {style.label}
      </span>
    );
  }

  const [creationMode, setCreationMode] = useState<"element" | "sequence">("element");

  return (
    <div className="space-y-4">
      {!isPanelCollapsed && (
        <>
          <div className="cartesian-columns grid grid-cols-4 gap-4 my-3 overflow-x-auto pb-4">
            {grouped.map(({ type, groups }) => {
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
                      {groups.length === 0 ? (
                        <p className="hint-text">None yet.</p>
                      ) : (
                        <div className="overflow-x-auto border border-gray-200 rounded-lg">
                          <table className="w-full text-left border-collapse text-sm">
                            <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs uppercase font-medium">
                              <tr>
                                <th className="px-2 py-0 w-24">Variant</th>
                                <SortableColumnHeader
                                  label="Label"
                                  columnKey="label"
                                  activeKey={sortKey}
                                  activeDir={sortDir}
                                  onSort={onSort}
                                  onClear={onClear}
                                />
                                <SortableColumnHeader
                                  label="Values"
                                  columnKey="value"
                                  columnType="number"
                                  activeKey={sortKey}
                                  activeDir={sortDir}
                                  onSort={onSort}
                                  onClear={onClear}
                                />
                                <th className="px-2 py-0">Notes</th>
                                <th className="px-2 py-0 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {groups.map((g) => (
                                <tr key={g.representativeId} className="hover:bg-gray-50 transition-colors">
                                  <td className="px-2 py-1 align-middle">
                                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px" }}>
                                      {g.members.map((el) => (
                                        <span key={el.id}>{renderVariantBadge(el)}</span>
                                      ))}
                                    </div>
                                  </td>
                                  <td className="px-2 py-1 align-middle">
                                    {g.members.some((el) => el.label) ? (
                                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                        {g.members
                                          .filter((el) => el.label)
                                          .map((el) => (
                                            <span key={el.id} style={{ fontWeight: 700 }}>
                                              {el.label}
                                            </span>
                                          ))}
                                      </div>
                                    ) : (
                                      <span className="text-gray-400 italic">unnamed</span>
                                    )}
                                  </td>
                                  <td className="px-2 py-0 align-middle whitespace-nowrap">
                                    {g.stagger_values ? (
                                      <div className="flex items-center gap-2">
                                        <span className="font-mono">[{g.stagger_values.join(", ")}] µs</span>
                                        <FrametimeBadge staggerValues={g.stagger_values} />
                                      </div>
                                    ) : (
                                      <div className="font-mono">
                                        {g.value_min}–{g.value_max}
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-2 py-0 align-middle text-xs text-gray-500">
                                    {g.members
                                      .map((el) => el.details)
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </td>
                                  <td className="px-2 py-0 align-middle text-right">
                                    <RequireRole minimum="editor">
                                      {g.memberIds.map((id) => (
                                        <button
                                          key={id}
                                          className="text-red-600 hover:text-red-800 text-xs font-medium ml-2"
                                          onClick={() => void handleDelete(id)}
                                        >
                                          Delete
                                        </button>
                                      ))}
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
