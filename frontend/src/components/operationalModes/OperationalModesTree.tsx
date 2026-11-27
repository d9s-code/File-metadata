import { Fragment, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Modal } from "../common/Modal";
import { MenuButton } from "../common/MenuButton";
import { EmptyState } from "../common/EmptyState";
import { RequireRole } from "../../auth/RequireAuth";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { ApiRequestError } from "../../api/client";
import type { OperationalMode } from "../../api/operationalModes";
import type { Mode } from "../../types/domain";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";
import { useBatchEditModes, useEmitterModes } from "../../state/hooks/useModes";
import {
  useCreateOperationalMode,
  useDeleteOperationalMode,
  useOperationalModes,
  useOrderOperationalModes,
  usePlanComments,
  useUpdateOperationalMode,
} from "../../state/hooks/useOperationalModes";
import { PlanEditor, draftFrom, draftPlan, draftProblem } from "./PlanEditor";
import { PlanComments, commentCounts } from "./PlanComments";
import { SetOnModesDialog } from "./SetOnModesDialog";
import { PLAN_LABEL, PLAN_PARAMS, effectivePlan, planCoverage, valueText, comboText, type PlanCoverage } from "./planCoverage";
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
  const [plan, setPlan] = useState(() => draftFrom(initial?.plan));
  const planBad = draftProblem(plan);
  const byIdAll = new Map(flatten(nodes).map((x) => [x.op.id, x]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Give it a name");
    if (problem || scanBad || planBad) return;
    const box = scanMin.trim() && scanMax.trim();
    const input = {
      name: name.trim(),
      parent_id: parent || null,
      illumination_time_ms: illumination.trim() ? Number(illumination) : null,
      scan_min_s: box ? Number(scanMin) : null,
      scan_max_s: box ? Number(scanMax) : null,
      description: description.trim() || null,
      plan: draftPlan(plan),
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
    <Modal title={initial ? `Edit ${initial.name}` : "Add operational mode"} onClose={onClose} wide>
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
        <PlanEditor draft={plan} onChange={setPlan} inherited={parentNode ? effectivePlan(parentNode, byIdAll) : null} />
        {planBad && <p className="line-row-problem">{planBad}</p>}
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={create.isPending || update.isPending || !!problem || !!scanBad || !!planBad}>
            {initial ? "Save" : "Add"}
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
  const [commentsOn, setCommentsOn] = useState<{ opId: string | null; title: string } | null>(null);
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [openGaps, setOpenGaps] = useState<Set<string>>(new Set());
  const { data: comments } = usePlanComments(emitterId);
  const { roots, unlinked, byId } = useMemo(() => buildTree(ops ?? [], modes ?? []), [ops, modes]);
  const all = flatten(roots);
  // Each operational mode that plans something itself, against the Modes under it.
  const coverage = useMemo(() => {
    const out = new Map<string, PlanCoverage>();
    for (const x of flatten(roots)) {
      const c = planCoverage(x, byId);
      if (c) out.set(x.op.id, c);
    }
    return out;
  }, [roots, byId]);
  const gaps = (node: TreeNode): boolean => (coverage.get(node.op.id)?.uncovered ?? 0) > 0 || node.children.some(gaps);
  const planned = [...coverage.values()];
  const totalCombos = planned.reduce((n, c) => n + c.combos.length, 0);
  const totalGaps = planned.reduce((n, c) => n + c.uncovered, 0);
  const planNotes = commentCounts(comments ?? [], null);
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
      <td />
    </tr>
  );

  const commentButton = (opId: string | null, title: string) => {
    const { total, open } = commentCounts(comments ?? [], opId);
    return (
      <button
        type="button"
        className={open ? "op-comments has-open" : "op-comments"}
        aria-label={`Comments on ${title}${total ? `: ${total}, ${open} open` : ""}`}
        title={total ? `${total} comment${total === 1 ? "" : "s"}, ${open} open` : "Comment"}
        onClick={() => setCommentsOn({ opId, title: `Comments — ${title}` })}
      >
        💬{total ? ` ${total}` : ""}
        {open > 0 && <span className="op-open-badge">{open} open</span>}
      </button>
    );
  };

  /** Its own plan, each value flagged covered or not, what it takes from above, and its combinations. */
  const planCell = (node: TreeNode) => {
    const own = node.op.plan;
    const cov = coverage.get(node.op.id);
    const inherited = PLAN_PARAMS.filter((k) => !own?.[k]?.length && cov?.plan.from[k]);
    if (!cov) {
      const eff = effectivePlan(node, byId);
      const from = [...new Set(Object.values(eff.from))];
      return from.length ? <span className="hint-text">plan from {from.join(", ")}</span> : null;
    }
    const open = openGaps.has(node.op.id);
    return (
      <div className="op-plan">
        <span className="op-params">
          {PLAN_PARAMS.filter((k) => own?.[k]?.length).flatMap((k) =>
            own![k]!.map((v, i) => {
              const ok = cov.valueCovered[k]?.[i];
              return (
                <span
                  key={`${k}${i}`}
                  className={ok ? "op-param op-planned covered" : "op-param op-planned uncovered"}
                  title={`${ok ? "A Mode under it covers it" : "No Mode under it covers it"}${v.note ? ` — ${v.note}` : ""}`}
                >
                  <span className="op-param-label">
                    {PLAN_LABEL[k]}
                    {k === "pri" && own!.pri_dwell_switch ? " D&S" : ""}
                  </span>{" "}
                  {valueText(v, k)} {ok ? "✓" : "⚠"}
                  {v.note ? " ✎" : ""}
                </span>
              );
            }),
          )}
        </span>
        {inherited.length > 0 && (
          <span className="jitter-subline">
            {inherited.map((k) => `${PLAN_LABEL[k]} from ${cov.plan.from[k]}`).join(" · ")}
          </span>
        )}
        {cov.combos.length > 1 || cov.uncovered ? (
          <button
            type="button"
            className={cov.uncovered ? "link-button op-gaps bad" : "link-button op-gaps"}
            aria-expanded={open}
            onClick={() => setOpenGaps((s) => toggle(s, node.op.id))}
          >
            {cov.combos.length} combination{cov.combos.length === 1 ? "" : "s"}
            {cov.uncovered ? ` · ${cov.uncovered} not covered` : " · all covered"} {open ? "▾" : "▸"}
          </button>
        ) : null}
        {open && (
          <ul className="op-combos">
            {cov.combos.map(({ combo, mode }, i) => (
              <li key={i} className={mode ? "covered" : "uncovered"}>
                {mode ? "✓" : "⚠"} {comboText(combo)}
                {mode ? <span className="hint-text"> — {mode.name}</span> : <span className="hint-text"> — no Mode under it</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  const nodeRows = (node: TreeNode): ReactNode => {
    if (onlyGaps && !gaps(node)) return null;
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
          <td>{planCell(node)}</td>
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
          <td className="row-actions op-actions">
            {commentButton(node.op.id, node.path)}
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
                  { label: "Edit… (plan, details)", disabled: !canEdit, title: editTitle, onSelect: () => setEditing(node.op) },
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
            {!onlyGaps && node.modes.map((m) => modeRow(m, node, node.depth + 1))}
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
      <div className="op-plan-bar">
        {totalCombos > 0 ? (
          <span className={totalGaps ? "op-plan-summary bad" : "op-plan-summary"}>
            Plan: {totalCombos} combination{totalCombos === 1 ? "" : "s"} across {planned.length} operational mode
            {planned.length === 1 ? "" : "s"} — {totalGaps ? `${totalGaps} not covered by a Mode` : "all covered"}
          </span>
        ) : (
          <span className="hint-text">No plan yet — plan an operational mode&apos;s RF, PRI and PW under Edit…, to see what its Modes cover.</span>
        )}
        <label className="inline-check">
          <input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} disabled={!totalGaps && !onlyGaps} />
          Only what isn&apos;t covered
        </label>
        <button type="button" className="button secondary small" onClick={() => setCommentsOn({ opId: null, title: "Notes on the whole plan" })}>
          Plan notes{planNotes.total ? ` (${planNotes.total}${planNotes.open ? `, ${planNotes.open} open` : ""})` : ""}
        </button>
      </div>
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
                <th>Parameters (its Modes)</th>
                <th>Plan</th>
                <th className="num">Illumination · scan</th>
                <th className="row-actions" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {roots.map(nodeRows)}
              {unlinked.length > 0 && !onlyGaps && (
                <>
                  <tr className="op-node-row op-unlinked">
                    <td className="op-select" />
                    <td colSpan={5}>
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
      {setting && <SetOnModesDialog emitterId={emitterId} node={setting} byId={byId} onClose={() => setSetting(null)} />}
      {commentsOn && (
        <PlanComments
          emitterId={emitterId}
          opId={commentsOn.opId}
          title={commentsOn.title}
          comments={comments ?? []}
          onClose={() => setCommentsOn(null)}
        />
      )}
      {dialog}
    </section>
  );
}
