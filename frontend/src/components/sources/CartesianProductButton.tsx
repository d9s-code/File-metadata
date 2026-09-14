import { useState } from "react";
import type { EwGroup, ElementVariant } from "../../types/domain";
import { useCartesianProduct, useElements } from "../../state/hooks/useElements";
import { ApiRequestError } from "../../api/client";
import { useQuery } from "@tanstack/react-query";
import { sourcesApi } from "../../api/sources";

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
}: {
  items: { id: string; label: string; variant?: ElementVariant }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  showVariant?: boolean;
}) {
  if (items.length === 0) return <p className="hint-text">No items available.</p>;
  
  if (showVariant) {
    return (
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="w-full text-left border-collapse text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs uppercase font-medium">
            <tr>
              <th className="px-2 py-1 w-24">Variant</th>
              <th className="px-2 py-1">Label</th>
              <th className="px-2 py-1 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {items.map((item) => (
              <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-2 py-1 align-middle whitespace-nowrap">
                  {item.variant ? (
                    (() => {
                      const rawVariant = item.variant.trim().toLowerCase();
                      const variantKey = rawVariant.replace(/-/g, "_") as keyof typeof VARIANT_STYLES;
                      const style = VARIANT_STYLES[variantKey] || {
                        label: rawVariant.replace(/_/g, " "),
                        bg: "#fef3c7",
                        fg: "#92400e",
                        border: "#fcd34d",
                      };
                      return (
                        <span
                          className="inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase"
                          style={{ backgroundColor: style.bg, color: style.fg, borderColor: style.border }}
                        >
                          {style.label}
                        </span>
                      );
                    })()
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
  const [ewGroupId, setEwGroupId] = useState(ewGroups[0]?.id ?? "");
  const [namePrefix, setNamePrefix] = useState("Mode");
  const [batchNote, setBatchNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  function rangeLabel(min: number | null, max: number | null, engMin: number | null, engMax: number | null, unit: string) {
    if (engMin !== min || engMax !== max) {
      return `${engMin}–${engMax} ${unit} (raw ${min}–${max})`;
    }
    return `${min}–${max} ${unit}`;
  }

  const rfItems = (elements ?? [])
    .filter((e) => e.element_type === "rf")
    .sort((a, b) => {
      const orderA = a.variant ? VARIANT_ORDER[a.variant] ?? 99 : 99;
      const orderB = b.variant ? VARIANT_ORDER[b.variant] ?? 99 : 99;
      return orderA - orderB;
    })
    .map((e) => ({ 
      id: e.id, 
      label: rangeLabel(e.value_min, e.value_max, e.engineered_min, e.engineered_max, "MHz"),
      variant: e.variant 
    }));
  const pwItems = (elements ?? [])
    .filter((e) => e.element_type === "pw")
    .sort((a, b) => {
      const orderA = a.variant ? VARIANT_ORDER[a.variant] ?? 99 : 99;
      const orderB = b.variant ? VARIANT_ORDER[b.variant] ?? 99 : 99;
      return orderA - orderB;
    })
    .map((e) => ({ 
      id: e.id, 
      label: rangeLabel(e.value_min, e.value_max, e.engineered_min, e.engineered_max, "µs"),
      variant: e.variant 
    }));
  const priItems = (elements ?? [])
    .filter((e) => e.element_type === "pri")
    .sort((a, b) => {
      const orderA = a.variant ? VARIANT_ORDER[a.variant] ?? 99 : 99;
      const orderB = b.variant ? VARIANT_ORDER[b.variant] ?? 99 : 99;
      return orderA - orderB;
    })
      .map((e) => ({
        id: e.id,
        label: e.stagger_values
          ? `stagger [${e.stagger_values.join(", ")}]`
          : rangeLabel(e.value_min, e.value_max, e.engineered_min, e.engineered_max, "µs"),
        variant: e.variant 
      }));

  const sequenceItems = (sequences ?? []).map((s) => ({
    id: s.id,
    label: s.label,
  }));

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
        sequence_ids: [...sequenceSelected],
        name_prefix: namePrefix,
        batch_note: batchNote || undefined,
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
          <strong>RF</strong>
          <CheckboxList items={rfItems} selected={rfSelected} onToggle={(id) => setRfSelected((s) => toggle(s, id))} showVariant={true} />
        </div>
        <div>
          <strong>PRI</strong>
          <CheckboxList items={priItems} selected={priSelected} onToggle={(id) => setPriSelected((s) => toggle(s, id))} showVariant={true} />
        </div>
        <div>
          <strong>PW</strong>
          <CheckboxList items={pwItems} selected={pwSelected} onToggle={(id) => setPwSelected((s) => toggle(s, id))} showVariant={true} />
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
