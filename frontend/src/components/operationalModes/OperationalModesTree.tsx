import { Fragment, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Modal } from "../common/Modal";
import { MenuButton } from "../common/MenuButton";
import { EmptyState } from "../common/EmptyState";
import { RequireRole } from "../../auth/RequireAuth";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { ApiRequestError } from "../../api/client";
import type { OperationalMode, SetValuesInput } from "../../api/operationalModes";
import type { ModeBatchEditError } from "../../api/modes";
import type { Mode } from "../../types/domain";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";
import { useBatchEditModes, useEmitterModes } from "../../state/hooks/useModes";
import {
  useCreateOperationalMode,
  useDeleteOperationalMode,
  useOperationalModes,
  useOrderOperationalModes,
  useSetValuesBelow,
  useUpdateOperationalMode,
} from "../../state/hooks/useOperationalModes";
import { PARAMS, PARAM_LABEL, below, buildTree, flatten, ownParams, type ParamKey, type TreeNode } from "./opTree";
import { scanProblem } from "../modes/ModeMoreOptions";

const ms = (v: number) => `${Number(v.toFixed(3))} ms`;
const secs = ([a, b]: [number, number]) => `${a === b ? Number(a.toFixed(3)) : `${Number(a.toFixed(3))}–${Number(b.toFixed(3))}`} s`;

/** The illumination time as typed: a number above 0, or empty. */
export function illuminationProblem(text: string): string | null {
  return text.trim() && !(Number(text) > 0) ? "A number of milliseconds above 0, or leave it empty" : null;
}

function Params({ values, empty }: { values: Partial<Record<ParamKey, string>>; empty?: ReactNode }) {
  const keys = PARAMS.filter((k) => values[k] !== undefined);
  if (!keys.length) return <>{empty ?? null}</>;
  return (
    <span className="op-params">
      {keys.map((k) => (
        <span key={k} className="op-param">
          <span className="op-param-label">{PARAM_LABEL[k]}</span> {values[k]}
        </span>
      ))}
    </span>
  );
}

/** Adding or editing one: its name, what it sits under, its illumination time and description. */
function OperationalModeDialog({
  emitterId,
  initial,
  parentId,
  nodes,
  onClose,
}: {
  emitterId: string;
  initial?: OperationalMode;
  parentId?: string | null;
  nodes: TreeNode[];
  onClose: () => void;
}) {
  const create = useCreateOperationalMode(emitterId);
  const update = useUpdateOperationalMode(emitterId);
  const [name, setName] = useState(initial?.name ?? "");
  const [parent, setParent] = useState(initial?.parent_id ?? parentId ?? "");
  const [illumination, setIllumination] = useState(initial?.illumination_time_ms != null ? String(initial.illumination_time_ms) : "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [scanMin, setScanMin] = useState(initial?.scan_min_s != null ? String(initial.scan_min_s) : "");
  const [scanMax, setScanMax] = useState(initial?.scan_max_s != null ? String(initial.scan_max_s) : "");
  const [error, setError] = useState<string | null>(null);
  const problem = illuminationProblem(illumination);
  const scanBad = scanProblem(scanMin, scanMax);
  // Not under itself or one of its own.
  const ownBranch = initial ? below(flatten(nodes).find((x) => x.op.id === initial.id)!) : new Set<string>();
  const options = flatten(nodes).filter((x) => !ownBranch.has(x.op.id));
  const parentNode = flatten(nodes).find((x) => x.op.id === parent);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Give it a name");
    if (problem || scanBad) return;
    const box = scanMin.trim() && scanMax.trim();
    const input = {
      name: name.trim(),
      parent_id: parent || null,
      illumination_time_ms: illumination.trim() ? Number(illumination) : null,
      scan_min_s: box ? Number(scanMin) : null,
      scan_max_s: box ? Number(scanMax) : null,
      description: description.trim() || null,
    };
    try {
      if (initial) await update.mutateAsync({ id: initial.id, input });
      else await create.mutateAsync(input);
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save it");
    }
  }

  return (
    <Modal title={initial ? `Edit ${initial.name}` : "Add operational mode"} onClose={onClose}>
      <form className="edit-fields" onSubmit={submit}>
        <label>
          Name
          <input value={name} placeholder="e.g. TRACK, or Track 1" onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label>
          Under
          <select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">— At the top —</option>
            {options.map((x) => (
              <option key={x.op.id} value={x.op.id}>
                {" ".repeat(x.depth)}
                {x.op.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Illumination time (ms)
          <input
            type="number"
            step="any"
            min="0"
            value={illumination}
            aria-invalid={!!problem || undefined}
            placeholder={parentNode?.illuminationMs != null ? `${parentNode.illuminationMs} — from ${parentNode.illuminationFrom}` : "Emitter's"}
            onChange={(e) => setIllumination(e.target.value)}
          />
          <span className={problem ? "line-row-problem" : "hint-text"}>
            {problem ??
              "How long the beam lights up a Platform each scan in this mode. Its Modes take it in the dwell planner; empty: the one above it, else the Emitter's."}
          </span>
        </label>
        <fieldset className="mode-scan-box">
          <legend>Scan period (s)</legend>
          <div className="mode-form-grid">
            <label>
              Min
              <input
                type="number"
                step="any"
                min="0"
                value={scanMin}
                aria-invalid={!!scanBad || undefined}
                placeholder={parentNode?.scanS ? String(parentNode.scanS[0]) : undefined}
                onChange={(e) => setScanMin(e.target.value)}
              />
            </label>
            <label>
              Max
              <input
                type="number"
                step="any"
                min="0"
                value={scanMax}
                aria-invalid={!!scanBad || undefined}
                placeholder={parentNode?.scanS ? String(parentNode.scanS[1]) : undefined}
                onChange={(e) => setScanMax(e.target.value)}
              />
            </label>
          </div>
          <p className={scanBad ? "line-row-problem" : "hint-text"}>
            {scanBad ??
              `Its Modes scan in this box unless one has its own. Empty: ${parentNode?.scanS ? `${parentNode.scanFrom}'s ${secs(parentNode.scanS)}` : "the EW Group's range"}.`}
          </p>
        </fieldset>
        <label>
          Description
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={create.isPending || update.isPending || !!problem || !!scanBad}>
            {initial ? "Save" : "Add"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type FieldKey = keyof SetValuesInput;
const VALUE_ROWS: { label: string; unit: string; fields: [FieldKey, FieldKey, FieldKey | null]; fixedOnly?: boolean }[] = [
  { label: "RF", unit: "MHz", fields: ["rf_min_mhz", "rf_max_mhz", "rf_delta"] },
  { label: "PRI", unit: "µs", fields: ["pri_min_us", "pri_max_us", "pri_delta"], fixedOnly: true },
  { label: "Jitter", unit: "µs", fields: ["jitter_min_us", "jitter_max_us", null], fixedOnly: true },
  { label: "PW", unit: "µs", fields: ["pw_min_us", "pw_max_us", "pw_delta"] },
];

/** The value every Mode under it has for this field, if they agree. */
function agreed(modes: Mode[], field: FieldKey): string {
  const vals = modes.map((m) => (m.line as unknown as Record<string, number | null | undefined> | null)?.[field] ?? null);
  return vals.length && vals.every((v) => v === vals[0]) && vals[0] != null ? String(vals[0]) : "";
}

/** Set values on every Mode under an operational mode — the RF range Track 1–3 share, say. */
function SetValuesDialog({ emitterId, node, onClose }: { emitterId: string; node: TreeNode; onClose: () => void }) {
  const setValues = useSetValuesBelow(emitterId);
  const start = useMemo(() => {
    const out: Partial<Record<FieldKey, string>> = {};
    for (const r of VALUE_ROWS) for (const f of r.fields) if (f) out[f] = agreed(node.allModes, f);
    return out;
  }, [node]);
  const [values, setFieldValues] = useState(start);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<ModeBatchEditError[] | null>(null);
  const allFixed = node.allModes.every((m) => m.pri_type === "fixed");
  const allStagger = node.allModes.length > 0 && node.allModes.every((m) => m.pri_type === "stagger");
  const startSteps = useMemo(() => {
    const all = node.allModes.map((m) => (m.line?.pri_stagger_values_us ?? []).join("/"));
    return allStagger && all.every((x) => x === all[0]) ? all[0] : "";
  }, [node, allStagger]);
  const startFrameDelta = useMemo(() => (allStagger ? agreed(node.allModes, "frame_time_delta_us") : ""), [node, allStagger]);
  const [steps, setSteps] = useState(startSteps);
  const [frameDelta, setFrameDelta] = useState(startFrameDelta);
  const stepValues = steps.split(/[\s,/]+/).filter(Boolean).map(Number);
  const stepsChanged = allStagger && steps.trim() !== "" && steps.trim() !== startSteps;
  const stepsBad = stepsChanged && (stepValues.length < 2 || stepValues.some((v) => !(v > 0)));
  const frameChanged = allStagger && frameDelta.trim() !== "" && frameDelta !== startFrameDelta;
  const frameBad = frameChanged && !(Number(frameDelta) >= 0);
  const numberFields = (Object.keys(values) as FieldKey[]).filter((k) => k !== "pri_stagger_values_us" && k !== "frame_time_delta_us");
  const changedNumbers = numberFields.filter((k) => (values[k] ?? "").trim() !== "" && values[k] !== start[k]);
  const changed = [...changedNumbers, ...(stepsChanged ? ["pri_stagger_values_us" as FieldKey] : []), ...(frameChanged ? ["frame_time_delta_us" as FieldKey] : [])];
  const bad = [
    ...changedNumbers.filter((k) => !Number.isFinite(Number(values[k])) || Number(values[k]) < 0),
    ...(stepsBad ? ["pri_stagger_values_us" as FieldKey] : []),
    ...(frameBad ? ["frame_time_delta_us" as FieldKey] : []),
  ];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setErrors(null);
    if (!changed.length || bad.length) return;
    try {
      const input: SetValuesInput = Object.fromEntries(changedNumbers.map((k) => [k, Number(values[k])]));
      if (stepsChanged) input.pri_stagger_values_us = stepValues;
      if (frameChanged) input.frame_time_delta_us = Number(frameDelta);
      await setValues.mutateAsync({ id: node.op.id, values: input });
      onClose();
    } catch (err) {
      if (err instanceof ApiRequestError && Array.isArray(err.detail)) setErrors(err.detail as ModeBatchEditError[]);
      else setError(err instanceof ApiRequestError ? err.message : "Couldn't set them");
    }
  }

  return (
    <Modal title={`Set on every Mode under ${node.op.name}`} onClose={onClose} wide>
      <form onSubmit={submit} className="op-set-values">
        <p className="hint-text">
          On all {node.allModes.length} Mode{node.allModes.length === 1 ? "" : "s"} under {node.path}. A field already filled in is what
          they all have now; one left empty, they keep their own. Only what you change is set.
        </p>
        <table className="data-table op-set-table">
          <thead>
            <tr>
              <th />
              <th>Min</th>
              <th>Max</th>
              <th>± delta</th>
            </tr>
          </thead>
          <tbody>
            {VALUE_ROWS.filter((r) => !r.fixedOnly || allFixed).map((r) => (
              <tr key={r.label}>
                <th scope="row">
                  {r.label} ({r.unit})
                </th>
                {r.fields.map((f, i) =>
                  f ? (
                    <td key={f}>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        aria-label={`${r.label} ${["min", "max", "delta"][i]}`}
                        value={values[f] ?? ""}
                        placeholder="Their own"
                        aria-invalid={bad.includes(f) || undefined}
                        onChange={(e) => setFieldValues((v) => ({ ...v, [f]: e.target.value }))}
                      />
                    </td>
                  ) : (
                    <td key={i} />
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {allStagger && (
          <div className="mode-form-grid op-set-stagger">
            <label>
              Stagger steps (µs)
              <input
                value={steps}
                placeholder="Their own, e.g. 300/400/500"
                aria-invalid={stepsBad || undefined}
                onChange={(e) => setSteps(e.target.value)}
              />
              <span className={stepsBad ? "line-row-problem" : "hint-text"}>
                {stepsBad ? "Two steps or more, each above 0" : "Separated by / , or spaces. A frame time written in by hand on a Mode stays."}
              </span>
            </label>
            <label>
              Frame time ± delta (µs)
              <input
                type="number"
                step="any"
                min="0"
                value={frameDelta}
                placeholder="Their own"
                aria-invalid={frameBad || undefined}
                onChange={(e) => setFrameDelta(e.target.value)}
              />
            </label>
          </div>
        )}
        {!allFixed && !allStagger && (
          <p className="hint-text">PRI, jitter and stagger steps are set on each Mode: these aren&apos;t all Fixed, nor all stagger.</p>
        )}
        {!allFixed && allStagger && <p className="hint-text">They&apos;re all stagger: no PRI range or jitter to set.</p>}
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
          <button type="submit" className="button primary" disabled={!changed.length || !!bad.length || setValues.isPending}>
            {changed.length ? `Set ${changed.length} value${changed.length === 1 ? "" : "s"}` : "Nothing changed"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** The radar as a tree on the Emitter's Operational modes tab: its
 * operational modes (TRACK → Track 1, 2, 3…), each with its Modes, and each
 * parameter shown where everything below agrees — the RF range Track 1–3
 * share on TRACK, the PRI that differs on each. */
export function OperationalModesTree({ emitterId }: { emitterId: string }) {
  const { data: ops } = useOperationalModes(emitterId);
  const { data: modes } = useEmitterModes(emitterId);
  const { data: emitter } = useEmitter(emitterId);
  const { canEdit } = useEmitterCheckoutState(emitter);
  const editTitle = canEdit ? undefined : "Start editing this Emitter first";
  const del = useDeleteOperationalMode(emitterId);
  const batch = useBatchEditModes(emitterId);
  const order = useOrderOperationalModes(emitterId);
  const { confirmDelete, dialog } = useConfirmDialog();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveTo, setMoveTo] = useState("");
  const [moveError, setMoveError] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ parentId: string | null } | null>(null);
  const [editing, setEditing] = useState<OperationalMode | null>(null);
  const [setting, setSetting] = useState<TreeNode | null>(null);
  const { roots, unlinked, byId } = useMemo(() => buildTree(ops ?? [], modes ?? []), [ops, modes]);
  const all = flatten(roots);
  const emitterMs = emitter?.illumination_time_ms ?? null;

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  async function remove(node: TreeNode) {
    const what = [node.modes.length && `${node.modes.length} Mode${node.modes.length === 1 ? "" : "s"}`, node.children.length && `${node.children.length} operational mode${node.children.length === 1 ? "" : "s"}`]
      .filter(Boolean)
      .join(" and ");
    const where = node.op.parent_id ? byId.get(node.op.parent_id)?.op.name : null;
    const message = `Delete operational mode "${node.op.name}"?${what ? ` Its ${what} move up ${where ? `to ${where}` : "to the top"}.` : ""}`;
    if (await confirmDelete(message)) await del.mutateAsync(node.op.id);
  }

  /** Its siblings, in the order shown. */
  const siblingsOf = (node: TreeNode) => {
    const parent = node.op.parent_id ? byId.get(node.op.parent_id) : null;
    return parent ? parent.children : roots;
  };

  async function shift(node: TreeNode, by: -1 | 1) {
    const ids = siblingsOf(node).map((x) => x.op.id);
    const i = ids.indexOf(node.op.id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await order.mutateAsync({ parentId: byId.has(node.op.parent_id ?? "") ? node.op.parent_id : null, ids });
  }

  async function move() {
    setMoveError(null);
    try {
      await batch.mutateAsync({ mode_ids: [...selected], fields: { operational_mode_id: moveTo === "none" ? null : moveTo } });
      setSelected(new Set());
      setMoveTo("");
    } catch (err) {
      setMoveError(err instanceof ApiRequestError ? err.message : "Couldn't move them");
    }
  }

  const modeRow = (m: Mode, node: TreeNode | null, depth: number) => (
    <tr key={m.id} className="op-mode-row">
      <td className="op-select">
        {canEdit && (
          <input type="checkbox" aria-label={`Select ${m.name}`} checked={selected.has(m.id)} onChange={() => setSelected((s) => toggle(s, m.id))} />
        )}
      </td>
      <td style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}>
        <Link to={`/emitters/${emitterId}?tab=modes&mode=${encodeURIComponent(m.name)}`}>{m.name}</Link>
      </td>
      <td>
        <Params values={ownParams(m, node)} empty={<span className="hint-text">as above</span>} />
      </td>
      <td />
      <td />
    </tr>
  );

  const nodeRows = (node: TreeNode): ReactNode => {
    const open = !collapsed.has(node.op.id);
    const own = node.op.illumination_time_ms != null;
    return (
      <Fragment key={node.op.id}>
        <tr className={`op-node-row depth-${Math.min(node.depth, 3)}`}>
          <td className="op-select" />
          <td style={{ paddingLeft: `${0.75 + node.depth * 1.25}rem` }}>
            <button
              type="button"
              className="op-toggle"
              aria-expanded={open}
              aria-label={`${open ? "Fold" : "Open"} ${node.op.name}`}
              onClick={() => setCollapsed((s) => toggle(s, node.op.id))}
            >
              {open ? "▾" : "▸"}
            </button>
            <strong>{node.op.name}</strong>
            <span className="jitter-subline">
              {node.allModes.length} Mode{node.allModes.length === 1 ? "" : "s"}
              {node.op.description ? ` · ${node.op.description}` : ""}
            </span>
          </td>
          <td>
            <Params values={node.shownHere} empty={node.allModes.length > 1 ? <span className="hint-text">nothing they all share</span> : null} />
          </td>
          <td className="num op-own">
            {node.illuminationMs != null ? (
              <>
                {ms(node.illuminationMs)}
                {!own && <span className="jitter-subline">from {node.illuminationFrom}</span>}
              </>
            ) : emitterMs != null ? (
              <span className="hint-text" title="None set here or above it: the Emitter's">
                {ms(emitterMs)} · Emitter&apos;s
              </span>
            ) : (
              <span className="hint-text">—</span>
            )}
            {node.scanS && (
              <span className="jitter-subline" title={node.op.scan_min_s != null ? "Its scan period" : `Its scan period, set on ${node.scanFrom}`}>
                scan {secs(node.scanS)}
                {node.op.scan_min_s == null ? ` · from ${node.scanFrom}` : ""}
              </span>
            )}
          </td>
          <td className="row-actions">
            <RequireRole minimum="editor">
              <MenuButton
                label="⋯"
                className="row-menu-button"
                ariaLabel={`Actions for ${node.op.name}`}
                items={[
                  { label: "Add under it…", disabled: !canEdit, title: editTitle, onSelect: () => setAdding({ parentId: node.op.id }) },
                  {
                    label: "Move up",
                    disabled: !canEdit || siblingsOf(node)[0]?.op.id === node.op.id,
                    title: editTitle,
                    onSelect: () => void shift(node, -1),
                  },
                  {
                    label: "Move down",
                    disabled: !canEdit || siblingsOf(node).at(-1)?.op.id === node.op.id,
                    title: editTitle,
                    onSelect: () => void shift(node, 1),
                  },
                  { label: "Edit…", disabled: !canEdit, title: editTitle, onSelect: () => setEditing(node.op) },
                  {
                    label: `Set on its ${node.allModes.length} Mode${node.allModes.length === 1 ? "" : "s"}…`,
                    disabled: !canEdit || !node.allModes.length,
                    title: !node.allModes.length ? "No Modes under it yet" : editTitle,
                    onSelect: () => setSetting(node),
                  },
                  { label: "Delete…", danger: true, disabled: !canEdit, title: editTitle, onSelect: () => void remove(node) },
                ]}
              />
            </RequireRole>
          </td>
        </tr>
        {open && (
          <>
            {node.children.map(nodeRows)}
            {node.modes.map((m) => modeRow(m, node, node.depth + 1))}
          </>
        )}
      </Fragment>
    );
  };

  return (
    <section className="card" aria-label="Operational modes">
      <div className="card-header">
        <h2 className="as-h4">Operational modes</h2>
        <RequireRole minimum="editor">
          <button className="button secondary small" disabled={!canEdit} title={editTitle} onClick={() => setAdding({ parentId: null })}>
            + Add operational mode
          </button>
        </RequireRole>
      </div>
      <p className="hint-text op-intro">
        The radar&apos;s operational modes — TRACK, say, holding Track 1, 2 and 3 — with the Modes transmitted in each. A value every Mode
        below agrees on shows once, on the highest one where they do; what differs shows lower down. <strong>Set on its Modes</strong> writes a
        value to every Mode under one. A Mode&apos;s illumination time is its operational mode&apos;s, else the nearest one above it with
        one, else the Emitter&apos;s{emitterMs != null ? ` (${ms(emitterMs)})` : ""}; its scan period likewise (unless the Mode has its own
        box), else its EW Group&apos;s. <strong>Move up / down</strong> orders them. Not exported.
      </p>
      {canEdit && selected.size > 0 && (
        <div className="op-move-bar">
          <span>
            {selected.size} Mode{selected.size === 1 ? "" : "s"} selected
          </span>
          <label>
            Move to
            <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              <option value="">—</option>
              <option value="none">No operational mode</option>
              {all.map((x) => (
                <option key={x.op.id} value={x.op.id}>
                  {" ".repeat(x.depth)}
                  {x.op.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="button primary small" disabled={!moveTo || batch.isPending} onClick={() => void move()}>
            Move
          </button>
          <button type="button" className="button secondary small" onClick={() => setSelected(new Set())}>
            Clear
          </button>
          {moveError && <span className="error-text">{moveError}</span>}
        </div>
      )}
      {!roots.length && !unlinked.length ? (
        <EmptyState compact icon="◎" title="No operational modes yet" message="Add the radar's operational modes, then put its Modes under them." />
      ) : (
        <div className="table-scroll">
          <table className="data-table op-tree">
            <thead>
              <tr>
                <th className="op-select" aria-label="Select" />
                <th>Operational mode · Mode</th>
                <th>Parameters</th>
                <th className="num">Illumination · scan</th>
                <th className="row-actions" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {roots.map(nodeRows)}
              {unlinked.length > 0 && (
                <>
                  <tr className="op-node-row op-unlinked">
                    <td className="op-select" />
                    <td colSpan={4}>
                      <strong>Not in an operational mode</strong>
                      <span className="jitter-subline">
                        {unlinked.length} Mode{unlinked.length === 1 ? "" : "s"} — select them to move them under one
                      </span>
                    </td>
                  </tr>
                  {unlinked.map((m) => modeRow(m, null, 1))}
                </>
              )}
            </tbody>
          </table>
        </div>
      )}
      {(adding || editing) && (
        <OperationalModeDialog
          key={editing?.id ?? `new-${adding?.parentId}`}
          emitterId={emitterId}
          initial={editing ?? undefined}
          parentId={adding?.parentId}
          nodes={roots}
          onClose={() => {
            setAdding(null);
            setEditing(null);
          }}
        />
      )}
      {setting && <SetValuesDialog emitterId={emitterId} node={setting} onClose={() => setSetting(null)} />}
      {dialog}
    </section>
  );
}
