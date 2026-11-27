import { useMemo, useState, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import { ApiRequestError } from "../../api/client";
import type { PlannedValue, SetValuesInput } from "../../api/operationalModes";
import type { ModeBatchEditError } from "../../api/modes";
import type { Mode } from "../../types/domain";
import { useEwGroups } from "../../state/hooks/useEwGroups";
import { useSources } from "../../state/hooks/useSources";
import { useGenerateFromPlan, useSetValuesBelow } from "../../state/hooks/useOperationalModes";
import type { TreeNode } from "./opTree";
import { asModeCombination, coveredBy, comboText, effectivePlan, type Combination, type PlanParam } from "./planCoverage";

type Row = "rf" | "pri" | "jitter" | "pw";
type Entry = { min: string; max: string };
const ROWS: { key: Row; label: string; unit: string; fields: [keyof SetValuesInput, keyof SetValuesInput]; delta?: keyof SetValuesInput }[] = [
  { key: "rf", label: "RF", unit: "MHz", fields: ["rf_min_mhz", "rf_max_mhz"], delta: "rf_delta" },
  { key: "pri", label: "PRI", unit: "µs", fields: ["pri_min_us", "pri_max_us"], delta: "pri_delta" },
  { key: "jitter", label: "Jitter", unit: "µs", fields: ["jitter_min_us", "jitter_max_us"] },
  { key: "pw", label: "PW", unit: "µs", fields: ["pw_min_us", "pw_max_us"], delta: "pw_delta" },
];

/** The value every Mode under it has for this line field, if they agree. */
function agreed(modes: Mode[], field: string): string {
  const vals = modes.map((m) => (m.line as unknown as Record<string, number | null | undefined> | null)?.[field] ?? null);
  return vals.length && vals.every((v) => v === vals[0]) && vals[0] != null ? String(vals[0]) : "";
}

const filled = (e: Entry) => e.min.trim() !== "" || e.max.trim() !== "";
const asValue = (e: Entry): PlannedValue => ({ min: Number(e.min || e.max), max: Number(e.max || e.min) });

/** Set on every Mode under an operational mode — or, with several values for
 * a parameter, make the cartesian product of them as new Modes under it. */
export function SetOnModesDialog({ emitterId, node, byId, onClose }: { emitterId: string; node: TreeNode; byId: Map<string, TreeNode>; onClose: () => void }) {
  const setValues = useSetValuesBelow(emitterId);
  const generate = useGenerateFromPlan(emitterId);
  const { data: groups } = useEwGroups(emitterId);
  const { data: sources } = useSources(emitterId);
  const modes = node.allModes;
  const allFixed = modes.length > 0 && modes.every((m) => m.pri_type === "fixed");
  const allStagger = modes.length > 0 && modes.every((m) => m.pri_type === "stagger");
  const plan = useMemo(() => effectivePlan(node, byId), [node, byId]);
  const hasPlan = Object.keys(plan.values).length > 0;

  const start = useMemo(() => {
    const entries = {} as Record<Row, Entry[]>;
    for (const r of ROWS) entries[r.key] = [{ min: agreed(modes, r.fields[0]), max: agreed(modes, r.fields[1]) }];
    const deltas = Object.fromEntries(ROWS.filter((r) => r.delta).map((r) => [r.key, agreed(modes, r.delta!)])) as Record<Row, string>;
    return { entries, deltas };
  }, [modes]);
  const [entries, setEntries] = useState(start.entries);
  const [deltas, setDeltas] = useState(start.deltas);
  const startSteps = useMemo(() => {
    const all = modes.map((m) => (m.line?.pri_stagger_values_us ?? []).join("/"));
    return allStagger && all.every((x) => x === all[0]) ? all[0] : "";
  }, [modes, allStagger]);
  const [steps, setSteps] = useState(startSteps);
  const [frameDelta, setFrameDelta] = useState(allStagger ? agreed(modes, "frame_time_delta_us") : "");
  const [group, setGroup] = useState("");
  const [source, setSource] = useState("");
  const [prefix, setPrefix] = useState(node.op.name);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<ModeBatchEditError[] | null>(null);

  const used = (k: Row) => entries[k].filter(filled);
  // Several values for a parameter, or no Modes to set them on: make Modes.
  const product = (["rf", "pri", "pw"] as Row[]).some((k) => used(k).length > 1) || modes.length === 0;
  // Making Modes: every row (they're Fixed). Setting: PRI and jitter only on Fixed ones.
  const shownRows = product ? ROWS : ROWS.filter((r) => (r.key !== "pri" && r.key !== "jitter") || allFixed);

  const combos = useMemo<Combination[]>(() => {
    if (!product) return [];
    let out: Combination[] = [{}];
    for (const k of ["rf", "pri", "pw"] as PlanParam[]) {
      const values = entries[k].filter(filled).map(asValue);
      out = out.flatMap((c) => values.map((v) => ({ ...c, [k]: v })));
    }
    return out;
  }, [entries, product]);
  const missing = product ? (["rf", "pri", "pw"] as Row[]).filter((k) => !used(k).length) : [];
  const covered = combos.map((c) => coveredBy(modes, c));
  const chosen = combos.filter((_, i) => !covered[i] && !skip.has(i));

  // A value above 0 (a jitter may be 0), its max not below its min.
  const badEntry = (e: Entry, row: Row) => {
    if (!filled(e)) return false;
    const lo = Number(e.min || e.max);
    const ok = row === "jitter" ? lo >= 0 : lo > 0;
    return !ok || !Number.isFinite(lo) || (e.min.trim() !== "" && e.max.trim() !== "" && Number(e.max) < Number(e.min));
  };
  const anyBad = ROWS.some((r) => entries[r.key].some((e) => badEntry(e, r.key)));

  // Set: what's changed from what they all have now.
  const changed: SetValuesInput = {};
  if (!product) {
    for (const r of ROWS) {
      if (!shownRows.includes(r)) continue;
      const [now, was] = [entries[r.key][0], start.entries[r.key][0]];
      if (now.min.trim() && now.min !== was.min) changed[r.fields[0]] = Number(now.min) as never;
      if (now.max.trim() && now.max !== was.max) changed[r.fields[1]] = Number(now.max) as never;
      if (r.delta && deltas[r.key]?.trim() && deltas[r.key] !== start.deltas[r.key]) changed[r.delta] = Number(deltas[r.key]) as never;
    }
    const values = steps.split(/[\s,/]+/).filter(Boolean).map(Number);
    if (allStagger && steps.trim() && steps.trim() !== startSteps) changed.pri_stagger_values_us = values;
    if (allStagger && frameDelta.trim() && frameDelta !== agreed(modes, "frame_time_delta_us")) changed.frame_time_delta_us = Number(frameDelta);
  }
  const stepsBad = !!changed.pri_stagger_values_us && (changed.pri_stagger_values_us.length < 2 || changed.pri_stagger_values_us.some((v) => !(v > 0)));

  function fillFromPlan() {
    const next = { ...entries };
    for (const k of ["rf", "pri", "pw"] as PlanParam[]) {
      const vs = plan.values[k];
      if (vs?.length) next[k] = vs.map((v) => ({ min: String(v.min), max: v.max != null && v.max !== v.min ? String(v.max) : "" }));
    }
    setEntries(next);
    setSkip(new Set());
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setErrors(null);
    try {
      if (product) {
        const jitter = entries.jitter[0];
        await generate.mutateAsync({
          id: node.op.id,
          input: {
            ew_group_id: group,
            source_id: source,
            name_prefix: prefix.trim(),
            combinations: chosen.map((c) => asModeCombination(c)!),
            jitter_min_us: jitter.min.trim() ? Number(jitter.min) : 0,
            jitter_max_us: jitter.max.trim() ? Number(jitter.max) : jitter.min.trim() ? Number(jitter.min) : 0,
          },
        });
      } else {
        await setValues.mutateAsync({ id: node.op.id, values: changed });
      }
      onClose();
    } catch (err) {
      if (err instanceof ApiRequestError && Array.isArray(err.detail)) setErrors(err.detail as ModeBatchEditError[]);
      else setError(err instanceof ApiRequestError ? err.message : "Couldn't do it");
    }
  }

  const nChanged = Object.keys(changed).length;
  const canSubmit = product
    ? !anyBad && !missing.length && chosen.length > 0 && !!group && !!source && !!prefix.trim() && !generate.isPending
    : !anyBad && !stepsBad && nChanged > 0 && !setValues.isPending;

  return (
    <Modal title={`Set on its Modes — ${node.path}`} onClose={onClose} wide>
      <form onSubmit={submit} className="op-set-values">
        <p className="hint-text">
          {modes.length
            ? `${modes.length} Mode${modes.length === 1 ? "" : "s"} under it. One value each: it's set on all of them (only what you change). `
            : "No Modes under it yet. "}
          Several values for RF, PRI or PW: their cartesian product is made as new Fixed Modes under it — the ones a Mode under it covers
          already are left out.
        </p>
        {hasPlan && (
          <button type="button" className="button secondary small" onClick={fillFromPlan}>
            Fill in from its plan
          </button>
        )}
        <table className="data-table op-set-table">
          <thead>
            <tr>
              <th />
              <th>Values (min – max)</th>
              <th>{product ? "" : "± delta"}</th>
            </tr>
          </thead>
          <tbody>
            {shownRows.map((r) => (
              <tr key={r.key}>
                <th scope="row">
                  {r.label} ({r.unit})
                </th>
                <td>
                  {entries[r.key].map((en, i) => (
                    <div key={i} className="op-set-entry">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        aria-label={`${r.label} min${i ? ` ${i + 1}` : ""}`}
                        value={en.min}
                        placeholder={modes.length ? "Their own" : "min"}
                        aria-invalid={badEntry(en, r.key) || undefined}
                        onChange={(e) => setEntries((x) => ({ ...x, [r.key]: x[r.key].map((y, j) => (j === i ? { ...y, min: e.target.value } : y)) }))}
                      />
                      <input
                        type="number"
                        step="any"
                        min="0"
                        aria-label={`${r.label} max${i ? ` ${i + 1}` : ""}`}
                        value={en.max}
                        placeholder={modes.length ? "Their own" : "max"}
                        aria-invalid={badEntry(en, r.key) || undefined}
                        onChange={(e) => setEntries((x) => ({ ...x, [r.key]: x[r.key].map((y, j) => (j === i ? { ...y, max: e.target.value } : y)) }))}
                      />
                      {i > 0 && (
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Remove ${r.label} value ${i + 1}`}
                          onClick={() => setEntries((x) => ({ ...x, [r.key]: x[r.key].filter((_, j) => j !== i) }))}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                  {r.key !== "jitter" && (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => setEntries((x) => ({ ...x, [r.key]: [...x[r.key], { min: "", max: "" }] }))}
                    >
                      + another {r.label}
                    </button>
                  )}
                </td>
                <td>
                  {!product && r.delta && (
                    <input
                      type="number"
                      step="any"
                      min="0"
                      aria-label={`${r.label} delta`}
                      value={deltas[r.key] ?? ""}
                      placeholder="Their own"
                      onChange={(e) => setDeltas((d) => ({ ...d, [r.key]: e.target.value }))}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!product && allStagger && (
          <div className="mode-form-grid op-set-stagger">
            <label>
              Stagger steps (µs)
              <input value={steps} placeholder="Their own, e.g. 300/400/500" aria-invalid={stepsBad || undefined} onChange={(e) => setSteps(e.target.value)} />
              <span className={stepsBad ? "line-row-problem" : "hint-text"}>
                {stepsBad ? "Two steps or more, each above 0" : "Separated by / , or spaces. A frame time written in by hand on a Mode stays."}
              </span>
            </label>
            <label>
              Frame time ± delta (µs)
              <input type="number" step="any" min="0" value={frameDelta} placeholder="Their own" onChange={(e) => setFrameDelta(e.target.value)} />
            </label>
          </div>
        )}

        {product && (
          <div className="op-product">
            <h3 className="as-h5">
              Cartesian product: {combos.length} combination{combos.length === 1 ? "" : "s"}
              {covered.some(Boolean) ? ` — ${covered.filter(Boolean).length} covered already` : ""}
            </h3>
            {missing.length > 0 ? (
              <p className="line-row-problem">Give at least one {missing.map((k) => ROWS.find((r) => r.key === k)!.label).join(" and ")} to make Modes.</p>
            ) : (
              <ul className="op-combos">
                {combos.map((c, i) => (
                  <li key={i}>
                    <label className="inline-check">
                      <input
                        type="checkbox"
                        disabled={!!covered[i]}
                        checked={!covered[i] && !skip.has(i)}
                        onChange={() =>
                          setSkip((s) => {
                            const n = new Set(s);
                            if (n.has(i)) n.delete(i);
                            else n.add(i);
                            return n;
                          })
                        }
                      />
                      {comboText(c)}
                      {covered[i] && <span className="hint-text"> — covered by {covered[i]!.name}</span>}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div className="mode-form-grid op-product-where">
              <label>
                EW Group
                <select value={group} onChange={(e) => setGroup(e.target.value)}>
                  <option value="">—</option>
                  {(groups ?? []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Source
                <select value={source} onChange={(e) => setSource(e.target.value)}>
                  <option value="">—</option>
                  {(sources ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Named
                <input value={prefix} onChange={(e) => setPrefix(e.target.value)} aria-label="Name prefix" />
                <span className="hint-text">&ldquo;{prefix.trim() || "…"} 1&rdquo;, &ldquo;{prefix.trim() || "…"} 2&rdquo;… — Fixed PRI, the admin&apos;s default deltas, one batch (deletable together).</span>
              </label>
            </div>
          </div>
        )}

        {error && <p className="error-text">{error}</p>}
        {errors && (
          <div className="error-text" role="alert">
            Nothing was set — it doesn&apos;t suit {errors.length} of them:
            <ul>
              {errors.map((x) => (
                <li key={x.mode_id}>
                  {x.mode_name}: {x.error}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={!canSubmit}>
            {product ? `Create ${chosen.length} Mode${chosen.length === 1 ? "" : "s"}` : nChanged ? `Set ${nChanged} value${nChanged === 1 ? "" : "s"}` : "Nothing changed"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
