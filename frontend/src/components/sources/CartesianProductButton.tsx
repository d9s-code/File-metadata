import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { EwGroup, ElementVariant, ParameterSequenceStep } from "../../types/domain";
import { useCartesianProduct, useElements } from "../../state/hooks/useElements";
import { ApiRequestError } from "../../api/client";
import { useQuery } from "@tanstack/react-query";
import { sourcesApi } from "../../api/sources";
import { groupElements } from "./elementMerge";
import { stepHas, stepValueText } from "./sequenceStep";
import { parsePositions } from "./firingOrder";
import { SortableColumnHeader } from "../common/SortableColumnHeader";
import { useSortableTable } from "../common/useSortableTable";
import { compareNullable, compareStrings } from "../common/sortUtils";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";
import { VARIANT_ORDER, VariantTag } from "./elementDisplay";

const DEFAULT_DELTA = "0";

type CheckboxItem = {
  id: string;
  /** The values the Modes get (engineered), e.g. "2899–2921". */
  label: string;
  /** The values as typed, when engineering changed them. */
  raw?: string;
  /** The Elements' own labels. */
  names?: string[];
  variants?: (ElementVariant | undefined)[];
  sortValue?: number | null;
};
type ItemSortKey = "label" | "value";

function compareItems(a: CheckboxItem, b: CheckboxItem, key: ItemSortKey, dir: "asc" | "desc"): number {
  switch (key) {
    case "label":
      return compareStrings(a.names?.join(", ") || null, b.names?.join(", ") || null, dir);
    case "value":
      return compareNullable(a.sortValue, b.sortValue, dir);
  }
}

/** A header checkbox for a whole list: ticked, unticked, or part-way. */
function AllCheckbox({ total, picked, onAll, onNone, label }: { total: number; picked: number; onAll: () => void; onNone: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (ref.current) ref.current.indeterminate = picked > 0 && picked < total;
  }, [picked, total]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={total > 0 && picked === total}
      disabled={total === 0}
      onChange={() => (picked === total ? onNone() : onAll())}
    />
  );
}

/** A click anywhere on a row but its inputs ticks it. */
function rowClick(onToggle: () => void) {
  return (e: ReactMouseEvent<HTMLTableRowElement>) => {
    if ((e.target as HTMLElement).closest("input, button, select, a, label")) return;
    onToggle();
  };
}

/** One parameter's Elements to pick from: a column that fills the height,
 * its header holding the select-all box, the count and range matching. */
function PickColumn({
  title,
  unit,
  items,
  selected,
  onToggle,
  onSetSelected,
  deltaOverrides,
  onDeltaChange,
  firingOrder,
  rangeMatching,
  onRangeMatching,
  headExtra,
  note,
  sort,
}: {
  title: string;
  unit: string;
  items: CheckboxItem[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSetSelected: (ids: Set<string>) => void;
  deltaOverrides: Record<string, string>;
  onDeltaChange: (id: string, value: string) => void;
  /** Stagger: each picked item's place in the firing order, instead of a delta. */
  firingOrder?: { values: Record<string, string>; onChange: (id: string, value: string) => void };
  rangeMatching: boolean;
  onRangeMatching: (v: boolean) => void;
  headExtra?: React.ReactNode;
  note?: React.ReactNode;
  sort: { sortKey: ItemSortKey | null; sortDir: "asc" | "desc"; onSort: (k: ItemSortKey, d: "asc" | "desc") => void; onClear: () => void };
}) {
  const picked = items.filter((i) => selected.has(i.id)).length;
  return (
    <section className="gen-col" aria-label={`${title} Elements to combine`}>
      <header className="gen-col-head">
        <AllCheckbox
          label={`All ${title}`}
          total={items.length}
          picked={picked}
          onAll={() => onSetSelected(new Set([...selected, ...items.map((i) => i.id)]))}
          onNone={() => onSetSelected(new Set([...selected].filter((id) => !items.some((i) => i.id === id))))}
        />
        <strong>{title}</strong>
        <span className={picked ? "gen-picked" : "hint-text"}>
          {picked} of {items.length}
        </span>
        {headExtra}
        <label className="gen-rm" title={`Range matching on the ${title} of every Mode made`}>
          <input type="checkbox" checked={rangeMatching} onChange={(e) => onRangeMatching(e.target.checked)} />
          Range matching
        </label>
      </header>
      {note}
      {items.length === 0 ? (
        <p className="hint-text gen-col-empty">No {title} Elements in this Source.</p>
      ) : (
        <div className="gen-list">
          <table className="data-table compact gen-table">
            <thead>
              <tr>
                <th aria-label="Pick" />
                <SortableColumnHeader
                  label={`Value (${unit})`}
                  columnKey="value"
                  columnType="number"
                  activeKey={sort.sortKey}
                  activeDir={sort.sortDir}
                  onSort={sort.onSort}
                  onClear={sort.onClear}
                />
                <SortableColumnHeader
                  label="Label"
                  columnKey="label"
                  activeKey={sort.sortKey}
                  activeDir={sort.sortDir}
                  onSort={sort.onSort}
                  onClear={sort.onClear}
                />
                <th className="gen-delta-col" title={firingOrder ? "Its place in the stagger, from 1" : `± delta on the Modes made (${unit}, 0 = none)`}>
                  {firingOrder ? "Order" : "±"}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const on = selected.has(item.id);
                return (
                  <tr key={item.id} className={on ? "gen-row on" : "gen-row"} onClick={rowClick(() => onToggle(item.id))}>
                    <td>
                      <input type="checkbox" checked={on} onChange={() => onToggle(item.id)} aria-label={`${title} ${item.label}`} />
                    </td>
                    <td className="gen-value" title={item.raw ? `As entered: ${item.raw} ${unit}` : undefined}>
                      <span className="figure">{item.label}</span>
                      {item.raw && <span className="gen-raw">raw {item.raw}</span>}
                    </td>
                    <td>
                      <span className="gen-names">
                        {(item.variants ?? []).filter(Boolean).map((v, i) => (
                          <VariantTag key={i} variant={v} />
                        ))}
                        {item.names && item.names.length > 0 && <span className="hint-text">{item.names.join(", ")}</span>}
                      </span>
                    </td>
                    <td className="gen-delta-col">
                      {on &&
                        (firingOrder ? (
                          <input
                            inputMode="numeric"
                            value={firingOrder.values[item.id] ?? ""}
                            onChange={(e) => firingOrder.onChange(item.id, e.target.value)}
                            placeholder="1"
                            title="Its place in the stagger, from 1 — e.g. 1, 3 fires it first and third"
                            aria-label={`Firing order of ${item.label}`}
                          />
                        ) : (
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={deltaOverrides[item.id] ?? DEFAULT_DELTA}
                            onChange={(e) => onDeltaChange(item.id, e.target.value)}
                            title={`± delta on the Modes made (${unit}, 0 = none)`}
                            aria-label={`${title} delta for ${item.label}`}
                          />
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

interface SequenceStepRow {
  id: string;
  sequenceId: string;
  label: string;
  hasRf: boolean;
  hasPw: boolean;
  hasPri: boolean;
}

/** Sequences with more steps than this start collapsed. */
const SEQUENCE_OPEN_LIMIT = 8;

function DeltaInput({
  param,
  value,
  onChange,
}: {
  param: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="number"
      min="0"
      step="any"
      className="gen-delta-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={`± ${param} delta applied to the generated Modes (0 = none)`}
      aria-label={`${param} delta`}
    />
  );
}

/** One sequence's steps as a collapsible, scrolling pick list, so a
 * 60-step sequence doesn't push the rest of the panel off screen. */
function SequenceStepGroup({
  label,
  rows,
  selected,
  onSetSelected,
  rfDeltas,
  priDeltas,
  pwDeltas,
  onRfDelta,
  onPriDelta,
  onPwDelta,
  stagger = false,
}: {
  label: string;
  rows: SequenceStepRow[];
  selected: Set<string>;
  onSetSelected: (ids: Set<string>) => void;
  rfDeltas: Record<string, string>;
  priDeltas: Record<string, string>;
  pwDeltas: Record<string, string>;
  onRfDelta: (id: string, v: string) => void;
  onPriDelta: (id: string, v: string) => void;
  onPwDelta: (id: string, v: string) => void;
  /** Stagger: the steps fire in step order and the PRI takes no delta. */
  stagger?: boolean;
}) {
  const [open, setOpen] = useState(rows.length <= SEQUENCE_OPEN_LIMIT);
  const selectedHere = rows.filter((r) => selected.has(r.id)).length;

  function toggleRow(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSetSelected(next);
  }

  return (
    <div className="sequence-step-group">
      <div className="sequence-step-group-header">
        <AllCheckbox
          label={`All steps of ${label}`}
          total={rows.length}
          picked={selectedHere}
          onAll={() => onSetSelected(new Set([...selected, ...rows.map((r) => r.id)]))}
          onNone={() => onSetSelected(new Set([...selected].filter((id) => !rows.some((r) => r.id === id))))}
        />
        <button type="button" className="link-button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "▾" : "▸"} {label}
        </button>
        <span className={selectedHere ? "gen-picked" : "hint-text"}>
          {selectedHere} of {rows.length} step{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      {open && (
        <div className="long-list-scroll">
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Step</th>
                <th style={{ width: "6.5rem" }}>RF delta</th>
                {!stagger && <th style={{ width: "6.5rem" }}>PRI delta</th>}
                <th style={{ width: "6.5rem" }}>PW delta</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isSelected = selected.has(row.id);
                return (
                  <tr key={row.id} className={isSelected ? "gen-row on" : "gen-row"} onClick={rowClick(() => toggleRow(row.id))}>
                    <td>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleRow(row.id)} aria-label={row.label} />{" "}
                      <span className="figure">{row.label}</span>
                    </td>
                    <td>
                      {isSelected && row.hasRf && (
                        <DeltaInput param="RF" value={rfDeltas[row.id] ?? DEFAULT_DELTA} onChange={(v) => onRfDelta(row.id, v)} />
                      )}
                    </td>
                    {!stagger && (
                      <td>
                        {isSelected && row.hasPri && (
                          <DeltaInput param="PRI" value={priDeltas[row.id] ?? DEFAULT_DELTA} onChange={(v) => onPriDelta(row.id, v)} />
                        )}
                      </td>
                    )}
                    <td>
                      {isSelected && row.hasPw && (
                        <DeltaInput param="PW" value={pwDeltas[row.id] ?? DEFAULT_DELTA} onChange={(v) => onPwDelta(row.id, v)} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
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
  const { data: emitter } = useEmitter(emitterId);
  const { canEdit } = useEmitterCheckoutState(emitter);

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
  // Per-step (composite `${sequenceId}:${order}` id) deltas — same as the
  // element deltas above.
  const [sequenceRfDeltaOverrides, setSequenceRfDeltaOverrides] = useState<Record<string, string>>({});
  const [sequencePwDeltaOverrides, setSequencePwDeltaOverrides] = useState<Record<string, string>>({});
  const [sequencePriDeltaOverrides, setSequencePriDeltaOverrides] = useState<Record<string, string>>({});
  const [ewGroupId, setEwGroupId] = useState(ewGroups[0]?.id ?? "");
  const [namePrefix, setNamePrefix] = useState("Mode");
  const [batchNote, setBatchNote] = useState("");
  const [rfRangeMatching, setRfRangeMatching] = useState(false);
  const [pwRangeMatching, setPwRangeMatching] = useState(false);
  const [priRangeMatching, setPriRangeMatching] = useState(false);
  const [priType, setPriType] = useState<"fixed" | "stagger">("fixed");
  // Stagger: each picked PRI Element's place(s) in the train, as typed ("1" or "1, 3").
  const [firingOrder, setFiringOrder] = useState<Record<string, string>>({});
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
    const pruneStepOverrides = (setFn: React.Dispatch<React.SetStateAction<Record<string, string>>>) =>
      setFn((prev) => {
        const next = Object.fromEntries(Object.entries(prev).filter(([id]) => validStepIds.has(id)));
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    pruneStepOverrides(setSequenceRfDeltaOverrides);
    pruneStepOverrides(setSequencePwDeltaOverrides);
    pruneStepOverrides(setSequencePriDeltaOverrides);
  }, [sequences]);

  const span = (lo: number | null, hi: number | null) => (lo === hi || hi == null ? `${lo}` : `${lo}–${hi}`);
  /** The values the Modes get, and the typed ones when engineering changed them. */
  function rangeLabel(min: number | null, max: number | null, engMin: number | null, engMax: number | null) {
    return { label: span(engMin, engMax), raw: engMin !== min || engMax !== max ? span(min, max) : undefined };
  }

  function defaultVariantSort(items: CheckboxItem[]): CheckboxItem[] {
    return [...items].sort((a, b) => {
      const orderA = a.variants?.[0] ? VARIANT_ORDER[a.variants[0]] ?? 99 : 99;
      const orderB = b.variants?.[0] ? VARIANT_ORDER[b.variants[0]] ?? 99 : 99;
      // Then by value, so a long list reads low to high.
      return orderA - orderB || compareNullable(a.sortValue, b.sortValue, "asc");
    });
  }

  const elementById = Object.fromEntries((elements ?? []).map((e) => [e.id, e]));

  const rfGroups = groupElements((elements ?? []).filter((e) => e.element_type === "rf"));
  const pwGroups = groupElements((elements ?? []).filter((e) => e.element_type === "pw"));
  const priGroups = groupElements((elements ?? []).filter((e) => e.element_type === "pri"));

  const rfItemsUnsorted = rfGroups.map((g) => {
    const rep = elementById[g.representativeId];
    return {
      id: g.representativeId,
      ...rangeLabel(g.value_min, g.value_max, rep?.engineered_min ?? g.value_min, rep?.engineered_max ?? g.value_max),
      names: g.members.map((m) => m.label).filter((n): n is string => !!n),
      variants: g.members.map((m) => m.variant ?? undefined),
      sortValue: g.value_min,
    };
  });
  const pwItemsUnsorted = pwGroups.map((g) => {
    const rep = elementById[g.representativeId];
    return {
      id: g.representativeId,
      ...rangeLabel(g.value_min, g.value_max, rep?.engineered_min ?? g.value_min, rep?.engineered_max ?? g.value_max),
      names: g.members.map((m) => m.label).filter((n): n is string => !!n),
      variants: g.members.map((m) => m.variant ?? undefined),
      sortValue: g.value_min,
    };
  });
  const priItemsUnsorted = priGroups.map((g) => {
    const rep = elementById[g.representativeId];
    return {
      id: g.representativeId,
      ...(g.stagger_values
        ? { label: `stagger [${g.stagger_values.join(", ")}]` }
        : rangeLabel(g.value_min, g.value_max, rep?.engineered_min ?? g.value_min, rep?.engineered_max ?? g.value_max)),
      names: g.members.map((m) => m.label).filter((n): n is string => !!n),
      variants: g.members.map((m) => m.variant ?? undefined),
      sortValue: g.value_min,
    };
  });

  // Each list gets its own independent sort state — sorting the RF column
  // must never re-sort PW/PRI, which a single shared useSortableTable call
  // used to do.
  const rfSort = useSortableTable<CheckboxItem, ItemSortKey>(rfItemsUnsorted, compareItems, "generateRf");
  const pwSort = useSortableTable<CheckboxItem, ItemSortKey>(pwItemsUnsorted, compareItems, "generatePw");
  const priSort = useSortableTable<CheckboxItem, ItemSortKey>(priItemsUnsorted, compareItems, "generatePri");

  const rfItems = rfSort.sortKey ? rfSort.sorted : defaultVariantSort(rfItemsUnsorted);
  const pwItems = pwSort.sortKey ? pwSort.sorted : defaultVariantSort(pwItemsUnsorted);
  const priItems = priSort.sortKey ? priSort.sorted : defaultVariantSort(priItemsUnsorted);

  function stepLabel(step: ParameterSequenceStep): string {
    const parts: string[] = [];
    for (const [param, name] of [["rf", "RF"], ["pri", "PRI"], ["pw", "PW"]] as const) {
      const text = stepValueText(step, param);
      if (text != null) parts.push(`${name} ${text}`);
    }
    return parts.join(", ") || "—";
  }

  // Individually selectable (sequence, step) pairs — a whole sequence is no
  // longer a single checkbox, so multi-step sequences don't force every step
  // to be used at once. Each row also carries which bounds it actually sets
  // (for conditionally showing a delta input).
  const sequenceStepRows = (sequences ?? []).flatMap((s) =>
    s.steps.map((step) => ({
      id: `${s.id}:${step.order}`,
      sequenceId: s.id,
      label: `step ${step.order}: ${stepLabel(step)}`,
      hasRf: stepHas(step, "rf"),
      hasPw: stepHas(step, "pw"),
      hasPri: stepHas(step, "pri"),
    })),
  );

  // Every selected item's delta is sent explicitly — 0 unless typed — so
  // what the field shows is exactly what the generated Modes get. A cleared
  // field counts as 0; anything else that isn't a number >= 0 is rejected.
  function deltaFor(overrides: Record<string, string>, id: string): number | null {
    const raw = (overrides[id] ?? DEFAULT_DELTA).trim();
    if (raw === "") return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function deltasFor(selected: Set<string>, overrides: Record<string, string>): Record<string, number> | null {
    const out: Record<string, number> = {};
    for (const id of selected) {
      const d = deltaFor(overrides, id);
      if (d === null) return null;
      out[id] = d;
    }
    return out;
  }

  /** The next free place in the firing order. */
  function nextPosition(orders: Record<string, string>, picked: Set<string>): string {
    const used = [...picked].flatMap((id) => parsePositions(orders[id] ?? "") ?? []);
    return String(used.length ? Math.max(...used) + 1 : 1);
  }

  function togglePri(id: string) {
    const next = toggle(priSelected, id);
    setPriSelected(next);
    if (priType !== "stagger") return;
    setFiringOrder((prev) => {
      const out = { ...prev };
      if (next.has(id)) out[id] = out[id]?.trim() ? out[id] : nextPosition(prev, priSelected);
      else delete out[id];
      return out;
    });
  }

  function setPriSelection(ids: Set<string>) {
    setPriSelected(ids);
    if (priType === "stagger") setFiringOrder(numbered(ids, firingOrder));
  }

  /** Picked PRI Elements without a place get the next ones, in list order. */
  function numbered(ids: Set<string>, prev: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const item of priItems) if (ids.has(item.id) && prev[item.id]?.trim()) out[item.id] = prev[item.id];
    for (const item of priItems) if (ids.has(item.id) && !out[item.id]) out[item.id] = nextPosition(out, ids);
    return out;
  }

  function changePriType(next: "fixed" | "stagger") {
    setPriType(next);
    if (next === "stagger") setFiringOrder(numbered(priSelected, firingOrder));
  }

  async function handleRun() {
    setError(null);
    setResult(null);
    if (!ewGroupId) {
      setError("Choose a target EW Group first.");
      return;
    }
    const rfDeltas = deltasFor(rfSelected, rfDeltaOverrides);
    const pwDeltas = deltasFor(pwSelected, pwDeltaOverrides);
    const priDeltas = deltasFor(priSelected, priDeltaOverrides);
    const steps = [...sequenceSelected].map((id) => {
      const sep = id.lastIndexOf(":");
      const row = sequenceStepRows.find((r) => r.id === id);
      return {
        sequence_id: id.slice(0, sep),
        order: Number(id.slice(sep + 1)),
        rf_delta: row?.hasRf ? deltaFor(sequenceRfDeltaOverrides, id) : undefined,
        pw_delta: row?.hasPw ? deltaFor(sequencePwDeltaOverrides, id) : undefined,
        pri_delta: row?.hasPri ? deltaFor(sequencePriDeltaOverrides, id) : undefined,
      };
    });
    const badStep = steps.some(
      (st) => st.rf_delta === null || st.pw_delta === null || (!stagger && st.pri_delta === null),
    );
    if (!rfDeltas || !pwDeltas || (!stagger && !priDeltas) || badStep) {
      setError("Every delta must be a number of 0 or more.");
      return;
    }
    let order: Record<string, number[]> | undefined;
    if (stagger) {
      const priSteps = steps.filter((st) => sequenceStepRows.find((r) => r.id === `${st.sequence_id}:${st.order}`)?.hasPri);
      if (priSelected.size === 0 && priSteps.length === 0) {
        setError("A stagger needs PRI Elements with a firing order, or Sequence steps that set PRI.");
        return;
      }
      if (priSelected.size > 0 && steps.length > 0) {
        setError("Make the stagger from PRI Elements or from Sequence steps, not both.");
        return;
      }
      order = {};
      for (const id of priSelected) {
        const positions = parsePositions(firingOrder[id] ?? "");
        if (!positions) {
          setError("Each picked PRI needs its place in the firing order: a whole number from 1, or several (1, 3).");
          return;
        }
        order[id] = positions;
      }
    }
    try {
      const res = await cartesianProduct.mutateAsync({
        ew_group_id: ewGroupId,
        rf_element_ids: [...rfSelected],
        pw_element_ids: [...pwSelected],
        pri_element_ids: [...priSelected],
        sequence_steps: steps.map((st) => ({
          ...st,
          rf_delta: st.rf_delta ?? undefined,
          pw_delta: st.pw_delta ?? undefined,
          pri_delta: stagger ? undefined : (st.pri_delta ?? undefined),
        })),
        name_prefix: namePrefix,
        batch_note: batchNote || undefined,
        rf_delta_overrides: rfDeltas,
        pw_delta_overrides: pwDeltas,
        pri_delta_overrides: stagger ? undefined : (priDeltas ?? undefined),
        rf_range_matching: rfRangeMatching,
        pw_range_matching: pwRangeMatching,
        pri_range_matching: priRangeMatching,
        pri_type: priType,
        pri_firing_order: order,
      });
      setResult(`Made ${res.count} Mode${res.count === 1 ? "" : "s"} — see the Generation log tab, or the Modes tab.`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Cartesian product failed");
    }
  }

  // How many Modes the run makes, as the backend counts them.
  const stagger = priType === "stagger";
  const pickedSteps = sequenceStepRows.filter((r) => sequenceSelected.has(r.id));
  const staggerTrains = pickedSteps.length
    ? new Set(pickedSteps.filter((r) => r.hasPri).map((r) => r.sequenceId)).size
    : priSelected.size > 0
      ? 1
      : 0;
  const priCount = stagger ? staggerTrains : pickedSteps.length || priSelected.size;
  const total = priCount * Math.max(rfSelected.size, 1) * Math.max(pwSelected.size, 1);
  const formula = [
    rfSelected.size ? `${rfSelected.size} RF` : null,
    stagger
      ? `${priCount} stagger${priCount === 1 ? "" : "s"}`
      : pickedSteps.length
        ? `${pickedSteps.length} step${pickedSteps.length === 1 ? "" : "s"}`
        : `${priSelected.size} PRI`,
    pwSelected.size ? `${pwSelected.size} PW` : null,
  ]
    .filter(Boolean)
    .join(" × ");
  const stepsReplacePri = !stagger && pickedSteps.length > 0 && priSelected.size > 0;
  const [showSequences, setShowSequences] = useState(false);
  const sequencesOpen = showSequences || pickedSteps.length > 0;
  const withSteps = (sequences ?? []).filter((seq) => seq.steps.length > 0);

  return (
    <fieldset className="edit-lock gen-panel" disabled={!canEdit} title={canEdit ? undefined : "Start editing this Emitter first"}>
      <p className="hint-text gen-intro">
        Tick RF, PRI and PW Elements — every combination becomes a new Mode.
        {!canEdit && " Start editing this Emitter to use it."}
      </p>
      <div className="gen-board">
        <PickColumn
          title="RF"
          unit="MHz"
          items={rfItems}
          selected={rfSelected}
          onToggle={(id) => setRfSelected((s) => toggle(s, id))}
          onSetSelected={setRfSelected}
          deltaOverrides={rfDeltaOverrides}
          onDeltaChange={(id, value) => setRfDeltaOverrides((prev) => ({ ...prev, [id]: value }))}
          rangeMatching={rfRangeMatching}
          onRangeMatching={setRfRangeMatching}
          sort={rfSort}
        />
        <PickColumn
          title="PRI"
          unit="µs"
          items={priItems}
          selected={priSelected}
          onToggle={togglePri}
          onSetSelected={setPriSelection}
          deltaOverrides={priDeltaOverrides}
          onDeltaChange={(id, value) => setPriDeltaOverrides((prev) => ({ ...prev, [id]: value }))}
          firingOrder={
            stagger ? { values: firingOrder, onChange: (id, v) => setFiringOrder((prev) => ({ ...prev, [id]: v })) } : undefined
          }
          rangeMatching={priRangeMatching}
          onRangeMatching={setPriRangeMatching}
          headExtra={
            <select
              className="gen-pri-type"
              value={priType}
              onChange={(e) => changePriType(e.target.value as "fixed" | "stagger")}
              aria-label="PRI type of the Modes made"
            >
              <option value="fixed">Fixed</option>
              <option value="stagger">Stagger</option>
            </select>
          }
          note={
            stagger ? (
              <p className="hint-text gen-col-note">
                One stagger from the ticked PRIs in their firing order (a range fires at its mean) — or tick Sequence steps
                instead; they fire in step order.
              </p>
            ) : undefined
          }
          sort={priSort}
        />
        <PickColumn
          title="PW"
          unit="µs"
          items={pwItems}
          selected={pwSelected}
          onToggle={(id) => setPwSelected((s) => toggle(s, id))}
          onSetSelected={setPwSelected}
          deltaOverrides={pwDeltaOverrides}
          onDeltaChange={(id, value) => setPwDeltaOverrides((prev) => ({ ...prev, [id]: value }))}
          rangeMatching={pwRangeMatching}
          onRangeMatching={setPwRangeMatching}
          sort={pwSort}
        />
      </div>

      {isSeqLoading ? (
        <p className="hint-text">Loading sequences…</p>
      ) : withSteps.length > 0 ? (
        <section className={sequencesOpen ? "gen-sequences open" : "gen-sequences"} aria-label="Sequence steps">
          <button
            type="button"
            className="link-button gen-sequences-toggle"
            onClick={() => setShowSequences((v) => !v)}
            aria-expanded={sequencesOpen}
            disabled={pickedSteps.length > 0}
            title={pickedSteps.length > 0 ? "Untick the steps to fold this away" : undefined}
          >
            {sequencesOpen ? "▾" : "▸"} Sequence steps
          </button>
          <span className={pickedSteps.length ? "gen-picked" : "hint-text"}>
            {pickedSteps.length
              ? `${pickedSteps.length} ticked`
              : `${withSteps.length} sequence${withSteps.length === 1 ? "" : "s"} · used in place of PRI Elements`}
          </span>
          {sequencesOpen && (
            <div className="gen-sequences-body">
              {withSteps.map((seq) => (
                <SequenceStepGroup
                  key={seq.id}
                  label={seq.label ?? "Sequence"}
                  rows={sequenceStepRows.filter((r) => r.sequenceId === seq.id)}
                  selected={sequenceSelected}
                  onSetSelected={setSequenceSelected}
                  rfDeltas={sequenceRfDeltaOverrides}
                  priDeltas={sequencePriDeltaOverrides}
                  pwDeltas={sequencePwDeltaOverrides}
                  onRfDelta={(id, v) => setSequenceRfDeltaOverrides((prev) => ({ ...prev, [id]: v }))}
                  onPriDelta={(id, v) => setSequencePriDeltaOverrides((prev) => ({ ...prev, [id]: v }))}
                  onPwDelta={(id, v) => setSequencePwDeltaOverrides((prev) => ({ ...prev, [id]: v }))}
                  stagger={stagger}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}

      <div className="gen-foot">
        <label>
          Into
          <select value={ewGroupId} onChange={(e) => setEwGroupId(e.target.value)} aria-label="Target EW Group">
            <option value="" disabled>
              EW Group…
            </option>
            {ewGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Named
          <input className="gen-prefix" placeholder="Name prefix" aria-label="Name prefix" value={namePrefix} onChange={(e) => setNamePrefix(e.target.value)} />
        </label>
        <input
          className="gen-note"
          placeholder="Batch note (optional)"
          aria-label="Batch note"
          value={batchNote}
          onChange={(e) => setBatchNote(e.target.value)}
        />
        <span className="gen-count" aria-live="polite">
          {total > 0 ? (
            <>
              {formula} = <strong>{total}</strong> Mode{total === 1 ? "" : "s"}
            </>
          ) : stagger ? (
            "Tick PRIs (or Sequence steps) for the stagger"
          ) : (
            "Tick at least one PRI (or Sequence step)"
          )}
          {stepsReplacePri && <span className="hint-text"> · steps replace the ticked PRIs</span>}
        </span>
        <button
          type="button"
          className="button primary"
          onClick={() => void handleRun()}
          disabled={cartesianProduct.isPending || !canEdit || total === 0}
        >
          {cartesianProduct.isPending ? "Generating…" : `Generate ${total || ""} Mode${total === 1 ? "" : "s"}`.replace("  ", " ")}
        </button>
      </div>
      {(result || error) && (
        <div className="gen-message">
          {result && <span className="hint-text" role="status">{result}</span>}
          {error && <span className="error-text">{error}</span>}
        </div>
      )}
    </fieldset>
  );
}
