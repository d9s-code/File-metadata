import { useState } from "react";
import type { EwGroup } from "../../types/domain";
import { useCartesianProduct, useElements } from "../../state/hooks/useElements";
import { ApiRequestError } from "../../api/client";

function CheckboxList({
  items,
  selected,
  onToggle,
}: {
  items: { id: string; label: string }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (items.length === 0) return <p className="hint-text">No elements of this type yet.</p>;
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

  const [rfSelected, setRfSelected] = useState<Set<string>>(new Set());
  const [pwSelected, setPwSelected] = useState<Set<string>>(new Set());
  const [priSelected, setPriSelected] = useState<Set<string>>(new Set());
  const [ewGroupId, setEwGroupId] = useState(ewGroups[0]?.id ?? "");
  const [namePrefix, setNamePrefix] = useState("Mode");
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
    .map((e) => ({ id: e.id, label: rangeLabel(e.value_min, e.value_max, e.engineered_min, e.engineered_max, "MHz") }));
  const pwItems = (elements ?? [])
    .filter((e) => e.element_type === "pw")
    .map((e) => ({ id: e.id, label: rangeLabel(e.value_min, e.value_max, e.engineered_min, e.engineered_max, "µs") }));
  const priItems = (elements ?? [])
    .filter((e) => e.element_type === "pri")
    .map((e) => ({
      id: e.id,
      label: e.stagger_values
        ? `stagger [${e.stagger_values.join(", ")}]`
        : `fixed ${rangeLabel(e.value_min, e.value_max, e.engineered_min, e.engineered_max, "")}`,
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
        name_prefix: namePrefix,
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
          <CheckboxList items={rfItems} selected={rfSelected} onToggle={(id) => setRfSelected((s) => toggle(s, id))} />
        </div>
        <div>
          <strong>PW</strong>
          <CheckboxList items={pwItems} selected={pwSelected} onToggle={(id) => setPwSelected((s) => toggle(s, id))} />
        </div>
        <div>
          <strong>PRI</strong>
          <CheckboxList items={priItems} selected={priSelected} onToggle={(id) => setPriSelected((s) => toggle(s, id))} />
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
        <button onClick={() => void handleRun()} disabled={cartesianProduct.isPending}>
          Generate Modes
        </button>
      </div>
      {result && <p className="hint-text">{result}</p>}
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}
