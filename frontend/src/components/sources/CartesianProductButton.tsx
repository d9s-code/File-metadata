import { useEffect, useState } from "react";
import type { EwGroup, ElementVariant } from "../../types/domain";
import { useCartesianProduct, useElements } from "../../state/hooks/useElements";
import { ApiRequestError } from "../../api/client";
import { useQuery } from "@tanstack/react-query";
import { sourcesApi } from "../../api/sources";
import { groupElements } from "./elementMerge";
import { SortableColumnHeader } from "../common/SortableColumnHeader";
import { useSortableTable } from "../common/useSortableTable";
import { compareNullable, compareStrings } from "../common/sortUtils";

type CheckboxItem = { id: string; label: string; variants?: (ElementVariant | undefined)[]; sortValue?: number | null };
type ItemSortKey = "label" | "value";

function compareItems(a: CheckboxItem, b: CheckboxItem, key: ItemSortKey, dir: "asc" | "desc"): number {
  switch (key) {
    case "label":
      return compareStrings(a.label, b.label, dir);
    case "value":
      return compareNullable(a.sortValue, b.sortValue, dir);
  }
}

const VARIANT_STYLES: Record<string, { label: string; bg: string; fg: string; border: string }> = {
  typical: { label: "typical", bg: "var(--badge-blue-bg)", fg: "var(--badge-blue-fg)", border: "var(--badge-blue-fg)" },
  discrete: { label: "discrete", bg: "var(--badge-green-bg)", fg: "var(--badge-green-fg)", border: "var(--badge-green-fg)" },
  most_probable: { label: "most-probable", bg: "#7c2d12", fg: "#fed7aa", border: "#ea580c" },
  extreme: { label: "extreme", bg: "var(--badge-red-bg)", fg: "var(--badge-red-fg)", border: "var(--badge-red-fg)" },
};

const VARIANT_ORDER: Record<string, number> = {
  typical: 0,
  discrete: 1,
  most_probable: 2,
  extreme: 3,
};

function CheckboxList({
  items,
  selected,
  onToggle,
  showVariant = false,
  deltaOverrides,
  onDeltaChange,
  elementDeltaById,
  sortKey,
  sortDir,
  onSort,
  onClear,
}: {
  items: CheckboxItem[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  showVariant?: boolean;
  /** Per-element delta override, keyed by element id — only rendered when both this and onDeltaChange are given. */
  deltaOverrides?: Record<string, string>;
  onDeltaChange?: (id: string, value: string) => void;
  /** The element's own stored delta, shown as the input's placeholder so it's
   * clear what "leave blank" means (use the element's own value, if any). */
  elementDeltaById?: Record<string, number | null>;
  sortKey?: ItemSortKey | null;
  sortDir?: "asc" | "desc";
  onSort?: (key: ItemSortKey, dir: "asc" | "desc") => void;
  onClear?: () => void;
}) {
  if (items.length === 0) return <p className="hint-text">No items available.</p>;
  const showDelta = !!(deltaOverrides && onDeltaChange);

  if (showVariant) {
    return (
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="w-full text-left border-collapse text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs uppercase font-medium">
            <tr>
              <th className="px-2 py-1 w-24">Variant</th>
              {onSort && onClear ? (
                <SortableColumnHeader
                  label="Label"
                  columnKey="label"
                  activeKey={sortKey ?? null}
                  activeDir={sortDir ?? "asc"}
                  onSort={onSort}
                  onClear={onClear}
                />
              ) : (
                <th className="px-2 py-1">Label</th>
              )}
              {showDelta && <th className="px-2 py-1 w-28">Delta override</th>}
              <th className="px-2 py-1 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {items.map((item) => (
              <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-2 py-1 align-middle whitespace-nowrap">
                  {item.variants && item.variants.some(Boolean) ? (
                    item.variants.filter(Boolean).map((variant, i) => {
                      const rawVariant = (variant as string).trim().toLowerCase();
                      const variantKey = rawVariant.replace(/-/g, "_") as keyof typeof VARIANT_STYLES;
                      const style = VARIANT_STYLES[variantKey] || {
                        label: rawVariant.replace(/_/g, " "),
                        bg: "#fef3c7",
                        fg: "#92400e",
                        border: "#fcd34d",
                      };
                      return (
                        <span
                          key={i}
                          className="inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase mr-1 mb-1"
                          style={{ backgroundColor: style.bg, color: style.fg, borderColor: style.border }}
                        >
                          {style.label}
                        </span>
                      );
                    })
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-2 py-1 align-middle">
                  <label className="checkbox-label flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={selected.has(item.id)} onChange={() => onToggle(item.id)} />
                    {item.label}
                  </label>
                </td>
                {showDelta && (
                  <td className="px-2 py-1 align-middle">
                    {selected.has(item.id) && (
                      <input
                        type="number"
                        min="0"
                        step="any"
                        style={{ width: "5.5rem" }}
                        value={deltaOverrides?.[item.id] ?? ""}
                        onChange={(e) => onDeltaChange?.(item.id, e.target.value)}
                        placeholder={
                          elementDeltaById?.[item.id] != null ? `${elementDeltaById[item.id]}` : "none"
                        }
                        title="Leave blank to use this element's own delta (if any)"
                      />
                    )}
                  </td>
                )}
                <td className="px-2 py-1 w-6"></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <ul className="checkbox-list">
      {items.map((item) => (
        <li key={item.id}>
          <label className="checkbox-label">
            <input type="checkbox" checked={selected.has(item.id)} onChange={() => onToggle(item.id)} />
            {item.label}
          </label>
        </li>
      ))}
    </ul>
  );
}

function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function CartesianProductButton({
  emitterId,
  sourceId,
  ewGroups,
}: {
  emitterId: string;
  sourceId: string;
  ewGroups: EwGroup[];
}) {
  const { data: elements } = useElements(emitterId, sourceId);
  const cartesianProduct = useCartesianProduct(emitterId, sourceId);

  const { data: sequences, isLoading: isSeqLoading } = useQuery({
    queryKey: ["sequences", emitterId, sourceId],
    queryFn: () => sourcesApi.listParameterSequences(emitterId, sourceId),
  });

  const [rfSelected, setRfSelected] = useState<Set<string>>(new Set());
  const [pwSelected, setPwSelected] = useState<Set<string>>(new Set());
  const [priSelected, setPriSelected] = useState<Set<string>>(new Set());
  const [sequenceSelected, setSequenceSelected] = useState<Set<string>>(new Set());
  const [rfDeltaOverrides, setRfDeltaOverrides] = useState<Record<string, string>>({});
  const [pwDeltaOverrides, setPwDeltaOverrides] = useState<Record<string, string>>({});
  const [priDeltaOverrides, setPriDeltaOverrides] = useState<Record<string, string>>({});
  const [ewGroupId, setEwGroupId] = useState(ewGroups[0]?.id ?? "");
  const [namePrefix, setNamePrefix] = useState("Mode");
  const [batchNote, setBatchNote] = useState("");
  const [rfRangeMatching, setRfRangeMatching] = useState(false);
  const [pwRangeMatching, setPwRangeMatching] = useState(false);
  const [priRangeMatching, setPriRangeMatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  // If an element gets deleted (or a sequence removed) while this panel is
  // open, drop any now-stale id from the selection/override state instead of
  // silently keeping a reference to something that no longer exists — the
  // checkbox already visually disappears, but without this the id would
  // still be submitted on Generate and get rejected server-side.
  useEffect(() => {
    const validIds = new Set((elements ?? []).map((e) => e.id));
    const prune = (setFn: React.Dispatch<React.SetStateAction<Set<string>>>) =>
      setFn((prev) => {
        const next = new Set([...prev].filter((id) => validIds.has(id)));
        return next.size === prev.size ? prev : next;
      });
    prune(setRfSelected);
    prune(setPwSelected);
    prune(setPriSelected);
    const pruneOverrides = (setFn: React.Dispatch<React.SetStateAction<Record<string, string>>>) =>
      setFn((prev) => {
        const next = Object.fromEntries(Object.entries(prev).filter(([id]) => validIds.has(id)));
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    pruneOverrides(setRfDeltaOverrides);
    pruneOverrides(setPwDeltaOverrides);
    pruneOverrides(setPriDeltaOverrides);
  }, [elements]);

  useEffect(() => {
    const validStepIds = new Set(
      (sequences ?? []).flatMap((s) => s.steps.map((step) => `${s.id}:${step.order}`)),
    );
    setSequenceSelected((prev) => {
      const next = new Set([...prev].filter((id) => validStepIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [sequences]);

  function rangeLabel(min: number | null, max: number | null, engMin: number | null, engMax: number | null, unit: string) {
    if (engMin !== min || engMax !== max) {
      return `${engMin}–${engMax} ${unit} (raw ${min}–${max})`;
    }
    return `${min}–${max} ${unit}`;
  }

  const { sortKey, sortDir, onSort, onClear } = useSortableTable<CheckboxItem, ItemSortKey>([], compareItems);
  const sortItems = (items: CheckboxItem[]) =>
    sortKey
      ? [...items].sort((a, b) => compareItems(a, b, sortKey, sortDir))
      : [...items].sort((a, b) => {
          const orderA = a.variants?.[0] ? VARIANT_ORDER[a.variants[0]] ?? 99 : 99;
          const orderB = b.variants?.[0] ? VARIANT_ORDER[b.variants[0]] ?? 99 : 99;
          return orderA - orderB;
        });

  const elementById = Object.fromEntries((elements ?? []).map((e) => [e.id, e]));

  const rfGroups = groupElements((elements ?? []).filter((e) => e.element_type === "rf"));
  const pwGroups = groupElements((elements ?? []).filter((e) => e.element_type === "pw"));
  const priGroups = groupElements((elements ?? []).filter((e) => e.element_type === "pri"));

  const rfItems = sortItems(
    rfGroups.map((g) => {
      const rep = elementById[g.representativeId];
      return {
        id: g.representativeId,
        label: rangeLabel(g.value_min, g.value_max, rep?.engineered_min ?? g.value_min, rep?.engineered_max ?? g.value_max, "MHz"),
        variants: g.members.map((m) => m.variant ?? undefined),
        sortValue: g.value_min,
      };
    }),
  );
  const pwItems = sortItems(
    pwGroups.map((g) => {
      const rep = elementById[g.representativeId];
      return {
        id: g.representativeId,
        label: rangeLabel(g.value_min, g.value_max, rep?.engineered_min ?? g.value_min, rep?.engineered_max ?? g.value_max, "µs"),
        variants: g.members.map((m) => m.variant ?? undefined),
        sortValue: g.value_min,
      };
    }),
  );
  const priItems = sortItems(
    priGroups.map((g) => {
      const rep = elementById[g.representativeId];
      return {
        id: g.representativeId,
        label: g.stagger_values
          ? `stagger [${g.stagger_values.join(", ")}]`
          : rangeLabel(g.value_min, g.value_max, rep?.engineered_min ?? g.value_min, rep?.engineered_max ?? g.value_max, "µs"),
        variants: g.members.map((m) => m.variant ?? undefined),
        sortValue: g.value_min,
      };
    }),
  );

  function stepLabel(step: { rf_mhz?: number | null; pw_us?: number | null; pri_us?: number | null }): string {
    const parts: string[] = [];
    if (step.rf_mhz != null) parts.push(`RF ${step.rf_mhz}`);
    if (step.pw_us != null) parts.push(`PW ${step.pw_us}`);
    if (step.pri_us != null) parts.push(`PRI ${step.pri_us}`);
    return parts.join(", ") || "—";
  }

  // Individually selectable (sequence, step) pairs — a whole sequence is no
  // longer a single checkbox, so multi-step sequences don't force every step
  // to be used at once.
  const sequenceItems = (sequences ?? []).flatMap((s) =>
    s.steps.map((step) => ({
      id: `${s.id}:${step.order}`,
      label: `${s.label ?? "Sequence"} · step ${step.order}: ${stepLabel(step)}`,
    })),
  );

  const elementDeltaById = Object.fromEntries((elements ?? []).map((e) => [e.id, e.delta]));

  function toOverridePayload(overrides: Record<string, string>): Record<string, number> | undefined {
    const entries = Object.entries(overrides)
      .map(([id, v]) => [id, Number(v)] as const)
      .filter(([, v]) => v !== null && !Number.isNaN(v) && Number.isFinite(v) && v >= 0);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  async function handleRun() {
    setError(null);
    setResult(null);
    if (!ewGroupId) {
      setError("Choose a target EW Group first.");
      return;
    }
    try {
      const res = await cartesianProduct.mutateAsync({
        ew_group_id: ewGroupId,
        rf_element_ids: [...rfSelected],
        pw_element_ids: [...pwSelected],
        pri_element_ids: [...priSelected],
        sequence_steps: [...sequenceSelected].map((id) => {
          const sep = id.lastIndexOf(":");
          return { sequence_id: id.slice(0, sep), order: Number(id.slice(sep + 1)) };
        }),
        name_prefix: namePrefix,
        batch_note: batchNote || undefined,
        rf_delta_overrides: toOverridePayload(rfDeltaOverrides),
        pw_delta_overrides: toOverridePayload(pwDeltaOverrides),
        pri_delta_overrides: toOverridePayload(priDeltaOverrides),
        rf_range_matching: rfRangeMatching,
        pw_range_matching: pwRangeMatching,
        pri_range_matching: priRangeMatching,
      });
      setResult(`Created ${res.count} mode(s).`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Cartesian product failed");
    }
  }

  return (
    <div className="card cartesian-panel">
      <h5>Cartesian Product</h5>
      <p className="hint-text">
        Choose RF, PW, and PRI elements to combine — every combination becomes a new Mode.
      </p>
      <div className="cartesian-columns">
        <div>
          <strong>RF</strong> <label className="checkbox-label" style={{ display: "inline-flex", width: "auto" }}>
            <input type="checkbox" checked={rfRangeMatching} onChange={(e) => setRfRangeMatching(e.target.checked)} />
            Range matching
          </label>
          <CheckboxList
            items={rfItems}
            selected={rfSelected}
            onToggle={(id) => setRfSelected((s) => toggle(s, id))}
            showVariant={true}
            deltaOverrides={rfDeltaOverrides}
            onDeltaChange={(id, value) => setRfDeltaOverrides((prev) => ({ ...prev, [id]: value }))}
            elementDeltaById={elementDeltaById}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            onClear={onClear}
          />
        </div>
        <div>
          <strong>PRI</strong> <label className="checkbox-label" style={{ display: "inline-flex", width: "auto" }}>
            <input type="checkbox" checked={priRangeMatching} onChange={(e) => setPriRangeMatching(e.target.checked)} />
            Range matching
          </label>
          <CheckboxList
            items={priItems}
            selected={priSelected}
            onToggle={(id) => setPriSelected((s) => toggle(s, id))}
            showVariant={true}
            deltaOverrides={priDeltaOverrides}
            onDeltaChange={(id, value) => setPriDeltaOverrides((prev) => ({ ...prev, [id]: value }))}
            elementDeltaById={elementDeltaById}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            onClear={onClear}
          />
        </div>
        <div>
          <strong>PW</strong> <label className="checkbox-label" style={{ display: "inline-flex", width: "auto" }}>
            <input type="checkbox" checked={pwRangeMatching} onChange={(e) => setPwRangeMatching(e.target.checked)} />
            Range matching
          </label>
          <CheckboxList
            items={pwItems}
            selected={pwSelected}
            onToggle={(id) => setPwSelected((s) => toggle(s, id))}
            showVariant={true}
            deltaOverrides={pwDeltaOverrides}
            onDeltaChange={(id, value) => setPwDeltaOverrides((prev) => ({ ...prev, [id]: value }))}
            elementDeltaById={elementDeltaById}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            onClear={onClear}
          />
        </div>
        <div>
          <strong>Sequences</strong>
          {isSeqLoading ? (
            <p className="hint-text">Loading sequences...</p>
          ) : (
            <CheckboxList items={sequenceItems} selected={sequenceSelected} onToggle={(id) => setSequenceSelected((s) => toggle(s, id))} />
          )}
        </div>
      </div>
      <div className="form-row">
        <select value={ewGroupId} onChange={(e) => setEwGroupId(e.target.value)}>
          <option value="" disabled>
            Target EW Group…
          </option>
          {ewGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <input placeholder="Name prefix" value={namePrefix} onChange={(e) => setNamePrefix(e.target.value)} />
        <textarea
          placeholder="Batch note (optional)..."
          value={batchNote}
          onChange={(e) => setBatchNote(e.target.value)}
          rows={2}
        />
        <button onClick={() => void handleRun()} disabled={cartesianProduct.isPending}>
          Generate Modes
        </button>
      </div>
      {result && <p className="hint-text">{result}</p>}
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}
