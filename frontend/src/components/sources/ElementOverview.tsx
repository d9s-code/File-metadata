import { useMemo, useState, type FormEvent } from "react";
import { InfoTip } from "../common/PageHeader";
import { Link } from "react-router-dom";
import type { ElementOverviewRow } from "../../api/elements";
import { ApiRequestError } from "../../api/client";
import type { ElementType, EwGroup } from "../../types/domain";
import { useAllSourcesProduct, useElementOverview } from "../../state/hooks/useElements";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";
import { elementValues, VariantTag } from "./elementDisplay";
import { parsePositions } from "./firingOrder";
import { useSessionState } from "../common/useSessionState";
import { ElementCleanupDialog } from "./ElementCleanupDialog";

const TYPES: [ElementType | "", string][] = [
  ["", "All"],
  ["rf", "RF"],
  ["pri", "PRI"],
  ["pw", "PW"],
  ["scan", "Scan"],
];
const UNIT: Record<ElementType, string> = { rf: "MHz", pri: "µs", pw: "µs", scan: "s" };
/** Source names shown in a row before the rest are folded into "+N". */
const SOURCES_SHOWN = 2;

/** A merged Element's id for picking it: its first Element (any of them
 * picks the whole group on the server). */
const rowId = (r: ElementOverviewRow) => r.occurrences[0].element_id;

function span(r: ElementOverviewRow): [number, number] | null {
  if (r.stagger_values?.length) return [Math.min(...r.stagger_values), Math.max(...r.stagger_values)];
  if (r.value_min == null || r.value_max == null) return null;
  return [r.value_min, r.value_max];
}

function margins(r: ElementOverviewRow): string {
  const d = [...new Set(r.occurrences.map((o) => o.delta).filter((v): v is number => v != null))].sort((a, b) => a - b);
  if (d.length === 0) return "—";
  return d.length === 1 ? `± ${d[0]}` : `± ${d[0]}–${d[d.length - 1]}`;
}

/** The Sources an Element is in, a couple by name and the rest as "+N" —
 * hover for every name, click to list them all. */
function SourceList({ emitterId, row }: { emitterId: string; row: ElementOverviewRow }) {
  const [open, setOpen] = useState(false);
  const sources = [...new Map(row.occurrences.map((o) => [o.source_id, o])).values()];
  const shown = open ? sources : sources.slice(0, SOURCES_SHOWN);
  const rest = sources.length - shown.length;
  return (
    <span className="all-sources-list" title={sources.map((o) => o.source_name).join("\n")}>
      {shown.map((o, i) => (
        <span key={o.source_id}>
          {i > 0 && ", "}
          <Link to={`/emitters/${emitterId}?tab=setup&source=${o.source_id}`}>{o.source_name}</Link>
        </span>
      ))}
      {rest > 0 && (
        <button type="button" className="chip-button" onClick={() => setOpen(true)} aria-label={`Show ${rest} more Sources`}>
          +{rest}
        </button>
      )}
      {open && sources.length > SOURCES_SHOWN && (
        <button type="button" className="link-button" onClick={() => setOpen(false)}>
          less
        </button>
      )}
    </span>
  );
}

/** All Sources: every Element of the Emitter's Sources in one list — the same
 * values in several Sources are one Element — to search, filter and generate
 * Modes from. Each generated Mode gets the Sources its Elements were found in. */
export function ElementOverview({ emitterId, ewGroups }: { emitterId: string; ewGroups: EwGroup[] }) {
  const { data: rows, isLoading } = useElementOverview(emitterId);
  const { data: emitter } = useEmitter(emitterId);
  const { canEdit } = useEmitterCheckoutState(emitter);
  const [type, setType] = useSessionState<ElementType | "">(`allSources.${emitterId}.type`, "");
  const [variant, setVariant] = useSessionState(`allSources.${emitterId}.variant`, "");
  const [sourceId, setSourceId] = useSessionState(`allSources.${emitterId}.sourceId`, "");
  const [search, setSearch] = useSessionState(`allSources.${emitterId}.search`, "");
  const [from, setFrom] = useSessionState(`allSources.${emitterId}.from`, "");
  const [to, setTo] = useSessionState(`allSources.${emitterId}.to`, "");
  const [sharedOnly, setSharedOnly] = useSessionState(`allSources.${emitterId}.sharedOnly`, false);
  const [open, setOpen] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [doneNote, setDoneNote] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);

  const variants = useMemo(
    () => [...new Set((rows ?? []).flatMap((r) => r.occurrences.map((o) => o.variant ?? "")))].filter(Boolean).sort(),
    [rows],
  );
  const sources = useMemo(
    () =>
      [...new Map((rows ?? []).flatMap((r) => r.occurrences.map((o) => [o.source_id, o.source_name] as const))).entries()].sort(
        (a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }),
      ),
    [rows],
  );
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const lo = from.trim() === "" ? null : Number(from);
  const hi = to.trim() === "" ? null : Number(to);
  const shown = (rows ?? []).filter((r) => {
    if (type && r.element_type !== type) return false;
    if (variant && !r.occurrences.some((o) => o.variant === variant)) return false;
    if (sourceId && !r.occurrences.some((o) => o.source_id === sourceId)) return false;
    if (sharedOnly && new Set(r.occurrences.map((o) => o.source_id)).size < 2) return false;
    if (lo != null || hi != null) {
      const s = span(r);
      if (!s || (lo != null && Number.isFinite(lo) && s[1] < lo) || (hi != null && Number.isFinite(hi) && s[0] > hi)) return false;
    }
    if (words.length) {
      const text = [
        r.element_type,
        elementValues(r),
        ...r.occurrences.flatMap((o) => [o.source_name, o.label ?? "", o.variant ?? ""]),
      ]
        .join(" ")
        .toLowerCase();
      if (!words.every((w) => text.includes(w))) return false;
    }
    return true;
  });
  const counts = Object.fromEntries(TYPES.map(([t]) => [t, (rows ?? []).filter((r) => !t || r.element_type === t).length]));
  const filtered = !!(variant || sourceId || search || from || to || sharedOnly);
  const selectable = (r: ElementOverviewRow) => canEdit && r.element_type !== "scan";
  const chosen = (rows ?? []).filter((r) => picked.has(rowId(r)));

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  return (
    <div className="card element-overview">
      <div className="card-header-row">
        <h4>
          All Sources <span className="hint-text">{rows ? `${rows.length} distinct Elements from ${sources.length} Sources` : ""}</span>{" "}
          <InfoTip label="About All Sources">
            Every Element of this Emitter&apos;s Sources in one list. The same values in several Sources are one Element,
            listing each Source. Tick Elements to generate Modes from them: each Mode gets the Sources its Elements were
            found in.
          </InfoTip>
        </h4>
        <span className="card-header-actions">
          {canEdit && (rows?.length ?? 0) > 0 && (
            <button
              type="button"
              className="button secondary"
              onClick={() => setCleaning(true)}
              title="Delete every Element with a name or value, from every Source — imported values that shouldn't be there"
            >
              Clean up…
            </button>
          )}
          <button type="button" className="link-button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Hide" : "Show"}
          </button>
        </span>
      </div>
      {cleaning && rows && (
        <ElementCleanupDialog
          emitterId={emitterId}
          rows={rows}
          onClose={() => setCleaning(false)}
          onDone={(message) => {
            setCleaning(false);
            setPicked(new Set());
            setDoneNote(message);
          }}
        />
      )}
      {open && (
        <>
          <div className="element-overview-filters">
            <div className="theme-toggle" role="group" aria-label="Element type">
              {TYPES.map(([t, label]) => (
                <button key={t} type="button" className={type === t ? "active" : undefined} onClick={() => setType(t)}>
                  {label} ({counts[t] ?? 0})
                </button>
              ))}
            </div>
            <input
              type="search"
              className="all-sources-search"
              placeholder="Search values, Sources, labels…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search Elements"
            />
            <span className="all-sources-range">
              <input
                type="number"
                step="any"
                placeholder="from"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="Values from"
              />
              –
              <input type="number" step="any" placeholder="to" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Values to" />
              <span className="hint-text">{type ? UNIT[type] : ""}</span>
            </span>
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} aria-label="Source">
              <option value="">Any Source</option>
              {sources.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <select value={variant} onChange={(e) => setVariant(e.target.value)} aria-label="Variant">
              <option value="">All variants</option>
              {variants.map((v) => (
                <option key={v} value={v}>
                  {v.replace("_", " ")}
                </option>
              ))}
            </select>
            <label className="inline-label">
              <input type="checkbox" checked={sharedOnly} onChange={(e) => setSharedOnly(e.target.checked)} /> In more than
              one Source
            </label>
            {filtered && (
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setVariant("");
                  setSourceId("");
                  setSearch("");
                  setFrom("");
                  setTo("");
                  setSharedOnly(false);
                }}
              >
                Reset
              </button>
            )}
            <span className="hint-text">{shown.length} shown</span>
          </div>
          {isLoading ? (
            <p className="hint-text">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="hint-text">{rows?.length ? "No Elements match the filters." : "No Elements in any Source yet."}</p>
          ) : (
            <div className="table-scroll element-overview-scroll">
              <table className="data-table all-sources-table">
                <thead>
                  <tr>
                    {canEdit && (
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Tick every Element shown"
                          checked={shown.filter(selectable).length > 0 && shown.filter(selectable).every((r) => picked.has(rowId(r)))}
                          onChange={(e) => {
                            const next = new Set(picked);
                            for (const r of shown.filter(selectable)) {
                              if (e.target.checked) next.add(rowId(r));
                              else next.delete(rowId(r));
                            }
                            setPicked(next);
                          }}
                        />
                      </th>
                    )}
                    <th>Type</th>
                    <th>Values</th>
                    <th>Delta</th>
                    <th>Variants</th>
                    <th>Sources</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const labels = [...new Set(r.occurrences.map((o) => o.label).filter(Boolean))];
                    return (
                      <tr key={rowId(r)} className={picked.has(rowId(r)) ? "selected-row" : undefined}>
                        {canEdit && (
                          <td>
                            {selectable(r) && (
                              <input
                                type="checkbox"
                                checked={picked.has(rowId(r))}
                                onChange={() => toggle(rowId(r))}
                                aria-label={`Tick ${elementValues(r)}`}
                              />
                            )}
                          </td>
                        )}
                        <td>{r.element_type.toUpperCase()}</td>
                        <td className="nowrap" title={labels.length ? `Labels: ${labels.join(", ")}` : undefined}>
                          {elementValues(r)}
                        </td>
                        <td className="nowrap">{margins(r)}</td>
                        <td className="nowrap">
                          {[...new Set(r.occurrences.map((o) => o.variant))].map((v) => (
                            <VariantTag key={v ?? "none"} variant={v} />
                          ))}
                        </td>
                        <td>
                          <SourceList emitterId={emitterId} row={r} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {doneNote && (
            <p className="success-text" role="status">
              {doneNote}
            </p>
          )}
          {canEdit && chosen.length > 0 && (
            <GenerateFromAll
              emitterId={emitterId}
              ewGroups={ewGroups}
              chosen={chosen}
              onClear={() => setPicked(new Set())}
              onDone={(message) => {
                setDoneNote(message);
                setPicked(new Set());
              }}
            />
          )}
          {!canEdit && (rows?.length ?? 0) > 0 && (
            <p className="hint-text">Start editing this Emitter to generate Modes from these Elements.</p>
          )}
        </>
      )}
    </div>
  );
}

/** Generate Modes from the ticked Elements: every RF × PRI × PW combination,
 * each Mode with the Sources its Elements came from. */
function GenerateFromAll({
  emitterId,
  ewGroups,
  chosen,
  onClear,
  onDone,
}: {
  emitterId: string;
  ewGroups: EwGroup[];
  chosen: ElementOverviewRow[];
  onClear: () => void;
  onDone: (message: string) => void;
}) {
  const product = useAllSourcesProduct(emitterId);
  const [groupId, setGroupId] = useState(ewGroups[0]?.id ?? "");
  const [prefix, setPrefix] = useState("Mode");
  const [note, setNote] = useState("");
  const [deltas, setDeltas] = useState<Partial<Record<ElementType, string>>>({});
  const [matching, setMatching] = useState({ rf: false, pri: false, pw: false });
  const [priType, setPriType] = useState<"fixed" | "stagger">("fixed");
  // Stagger: each ticked PRI's place in the train, as typed; blank takes its place in the list.
  const [firingOrder, setFiringOrder] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const of = (t: ElementType) => chosen.filter((r) => r.element_type === t);
  const rf = of("rf");
  const pri = of("pri");
  const pw = of("pw");
  const isStagger = priType === "stagger";
  const stagger = pri.filter((r) => r.stagger_values?.length).length;
  const mixed = !isStagger && stagger > 0 && stagger < pri.length;
  const count = Math.max(rf.length, 1) * (isStagger ? Math.min(pri.length, 1) : pri.length) * Math.max(pw.length, 1);
  const orderOf = (r: ElementOverviewRow, i: number) => firingOrder[rowId(r)] ?? String(i + 1);
  const sourceCount = new Set(chosen.flatMap((r) => r.occurrences.map((o) => o.source_id))).size;

  function overrides(rows: ElementOverviewRow[], t: ElementType) {
    const v = deltas[t]?.trim();
    return v ? Object.fromEntries(rows.map((r) => [rowId(r), Number(v)])) : undefined;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!groupId) return setError("Add an EW Group first.");
    if (pri.length === 0) return setError("Tick at least one PRI Element.");
    if (mixed) return setError("Tick Fixed-style PRI ranges or stagger sequences, not both.");
    let order: Record<string, number[]> | undefined;
    if (isStagger) {
      order = {};
      for (const [i, r] of pri.entries()) {
        const positions = parsePositions(orderOf(r, i));
        if (!positions) return setError("Each PRI needs its place in the firing order: a whole number from 1, or several (1, 3).");
        order[rowId(r)] = positions;
      }
    }
    try {
      const res = await product.mutateAsync({
        ew_group_id: groupId,
        rf_element_ids: rf.map(rowId),
        pri_element_ids: pri.map(rowId),
        pw_element_ids: pw.map(rowId),
        name_prefix: prefix.trim() || "Mode",
        batch_note: note.trim() || null,
        rf_delta_overrides: overrides(rf, "rf"),
        pri_delta_overrides: isStagger ? undefined : overrides(pri, "pri"),
        pw_delta_overrides: overrides(pw, "pw"),
        rf_range_matching: matching.rf,
        pri_range_matching: matching.pri,
        pw_range_matching: matching.pw,
        pri_type: priType,
        pri_firing_order: order,
      });
      onDone(`Generated ${res.count} Mode${res.count === 1 ? "" : "s"} in ${ewGroups.find((g) => g.id === groupId)?.name}.`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't generate the Modes.");
    }
  }

  return (
    <form className="all-sources-generate" onSubmit={handleSubmit}>
      <div className="all-sources-generate-head">
        <strong>
          {rf.length} RF × {isStagger ? "1 stagger" : `${pri.length} PRI`} × {pw.length} PW = {count} Mode
          {count === 1 ? "" : "s"}
        </strong>
        <span className="hint-text">
          from Elements in {sourceCount} Source{sourceCount === 1 ? "" : "s"} — each Mode gets the Sources its own Elements
          were found in
        </span>
        <button type="button" className="link-button" onClick={onClear}>
          Clear selection
        </button>
      </div>
      <div className="form-row">
        <label>
          EW Group
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {ewGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name prefix
          <input value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </label>
        <label>
          PRI type
          <select value={priType} onChange={(e) => setPriType(e.target.value as "fixed" | "stagger")}>
            <option value="fixed">Fixed</option>
            <option value="stagger">Stagger</option>
          </select>
        </label>
        {(["rf", "pri", "pw"] as const)
          .filter((t) => of(t).length > 0 && !(isStagger && t === "pri"))
          .map((t) => (
            <label key={t} title="Blank: each Element's widest delta among its Sources">
              {t.toUpperCase()} ± delta ({UNIT[t]})
              <input
                type="number"
                step="any"
                min="0"
                placeholder="widest"
                value={deltas[t] ?? ""}
                onChange={(e) => setDeltas({ ...deltas, [t]: e.target.value })}
              />
            </label>
          ))}
      </div>
      {isStagger && pri.length > 0 && (
        <div className="form-row stagger-order">
          <span className="hint-text">Firing order (a range fires at its mean):</span>
          {pri.map((r, i) => (
            <label key={rowId(r)} className="inline-label">
              {elementValues(r)}
              <input
                inputMode="numeric"
                style={{ width: "4.5rem" }}
                value={orderOf(r, i)}
                onChange={(e) => setFiringOrder({ ...firingOrder, [rowId(r)]: e.target.value })}
                title="Its place in the stagger, from 1 — e.g. 1, 3 fires it first and third"
              />
            </label>
          ))}
        </div>
      )}
      <div className="form-row">
        <span className="hint-text">Range matching:</span>
        {(["rf", "pri", "pw"] as const).map((t) => (
          <label key={t} className="inline-label">
            <input type="checkbox" checked={matching[t]} onChange={(e) => setMatching({ ...matching, [t]: e.target.checked })} />
            {t.toUpperCase()}
          </label>
        ))}
        <label className="wide-label">
          Note on each Mode
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
        </label>
      </div>
      {mixed && <p className="error-text">Fixed-style PRI ranges and stagger sequences can&apos;t be combined in one run.</p>}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="button primary" disabled={product.isPending || count === 0 || mixed || !groupId}>
        {product.isPending ? "Generating…" : `Generate ${count} Mode${count === 1 ? "" : "s"}`}
      </button>
    </form>
  );
}
