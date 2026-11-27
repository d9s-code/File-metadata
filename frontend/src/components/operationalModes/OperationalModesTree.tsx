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
import { PLAN_LABEL, PLAN_PARAMS, effectivePlan, planCoverage, comboText, type PlanCoverage } from "./planCoverage";
import { useModeDefaults } from "../../state/hooks/useDwells";
import { PARAMS, PARAM_LABEL, below, buildTree, flatten, ownParams, type ParamKey, type TreeNode } from "./opTree";
import type { EmitterScan } from "../../api/scans";
import { useScans } from "../../state/hooks/useScans";
import { patternName, scanTiming, spreadText } from "../scans/scanPatterns";

const VIEW_KEY = "operational-modes-view";
/** What a dragged Mode carries. */
const MODE_DRAG = "application/x-mode-id";

/** A scan in a line: "Rotate · 55.6 ms each 10 s" (or all the time). */
function scanLine(scan: EmitterScan): string {
  const t = scanTiming(scan);
  if (t.continuous) return `${scan.name} · all the time`;
  const ill = t.illuminationMs ? spreadText(t.illuminationMs, "ms") : null;
  const rev = t.revisitS ? spreadText(t.revisitS, "s") : null;
  // An ESA dwell in pulses: its illumination is each Mode's PRI × the pulses.
  const what = ill ?? (t.working.length ? t.working[0] : null);
  return [scan.name, what && rev ? `${what}, every ${rev}` : (what ?? (rev && `every ${rev}`))].filter(Boolean).join(" · ");
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

/** Adding or editing one: its name, what it sits under, its scan and description. */
function OperationalModeDialog({
  emitterId,
  initial,
  parentId,
  nodes,
  scans,
  onClose,
}: {
  emitterId: string;
  initial?: OperationalMode;
  parentId?: string | null;
  nodes: TreeNode[];
  scans: EmitterScan[];
  onClose: () => void;
}) {
  const create = useCreateOperationalMode(emitterId);
  const update = useUpdateOperationalMode(emitterId);
  const [name, setName] = useState(initial?.name ?? "");
  const [parent, setParent] = useState(initial?.parent_id ?? parentId ?? "");
  const [scanId, setScanId] = useState(initial?.scan_id ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [error, setError] = useState<string | null>(null);
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
    if (planBad) return;
    const input = {
      name: name.trim(),
      parent_id: parent || null,
      scan_id: scanId || null,
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
          Scan
          <select value={scanId} onChange={(e) => setScanId(e.target.value)}>
            <option value="">
              {parentNode?.scanId ? `— From ${parentNode.scanFrom}: ${scans.find((x) => x.id === parentNode.scanId)?.name} —` : "— None —"}
            </option>
            {scans.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} ({patternName(x.pattern)})
              </option>
            ))}
          </select>
          <span className="hint-text">
            {scans.length
              ? "How the antenna moves in this mode — the ones under it and its Modes take it (a Mode can have its own). Its illumination time and revisit go to the dwell planner."
              : "Add the radar's scans in the Scans card above first."}
            {scanId && scans.find((x) => x.id === scanId) ? ` ${scanLine(scans.find((x) => x.id === scanId)!)}.` : ""}
          </span>
        </label>
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
          <button type="submit" className="button primary" disabled={create.isPending || update.isPending || !!planBad}>
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
  // Table or containers — remembered in this browser.
  const [view, setView] = useState<"table" | "containers">(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "containers" ? "containers" : "table";
    } catch {
      return "table";
    }
  });
  const chooseView = (v: "table" | "containers") => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Not kept; fine.
    }
  };
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [openGaps, setOpenGaps] = useState<Set<string>>(new Set());
  const { data: comments } = usePlanComments(emitterId);
  // How far a stagger's step may be off and still match (the admin's Mode default).
  const stepTol = useModeDefaults().defaults.stagger_step_delta_us;
  const { data: scans } = useScans(emitterId);
  const scanById = useMemo(() => new Map((scans ?? []).map((x) => [x.id, x])), [scans]);
  const { roots, unlinked, byId, scanOf } = useMemo(
    () => buildTree(ops ?? [], modes ?? [], new Map((scans ?? []).map((x) => [x.id, x.name]))),
    [ops, modes, scans],
  );
  const all = flatten(roots);
  // Each operational mode that plans something itself, against the Modes under it.
  const coverage = useMemo(() => {
    const out = new Map<string, PlanCoverage>();
    for (const x of flatten(roots)) {
      const c = planCoverage(x, byId, stepTol);
      if (c) out.set(x.op.id, c);
    }
    return out;
  }, [roots, byId, stepTol]);
  const gaps = (node: TreeNode): boolean => (coverage.get(node.op.id)?.uncovered ?? 0) > 0 || node.children.some(gaps);
  const planned = [...coverage.values()];
  const totalCombos = planned.reduce((n, c) => n + c.combos.length, 0);
  const totalGaps = planned.reduce((n, c) => n + c.uncovered, 0);
  const planNotes = commentCounts(comments ?? [], null);

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

  /** A Mode dragged into a container (or out of all of them: "none"). */
  async function dropMode(modeId: string, target: string) {
    setDropOn(null);
    setMoveError(null);
    const m = (modes ?? []).find((x) => x.id === modeId);
    if (!m || (m.operational_mode_id ?? "none") === target) return;
    try {
      await batch.mutateAsync({ mode_ids: [modeId], fields: { operational_mode_id: target === "none" ? null : target } });
    } catch (err) {
      setMoveError(err instanceof ApiRequestError ? err.message : "Couldn't move it");
    }
  }

  /** Where a dragged Mode can be dropped: it, while editing. */
  const dropProps = (target: string) =>
    canEdit
      ? {
          onDragOver: (e: React.DragEvent) => {
            if (!e.dataTransfer.types.includes(MODE_DRAG)) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
            if (dropOn !== target) setDropOn(target);
          },
          onDragLeave: (e: React.DragEvent) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOn((d) => (d === target ? null : d));
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const id = e.dataTransfer.getData(MODE_DRAG);
            if (id) void dropMode(id, target);
          },
        }
      : {};

  const modeChip = (m: Mode, node: TreeNode | null) => {
    const own = ownParams(m, node, scanOf(m));
    const text = PARAMS.filter((k) => own[k] !== undefined)
      .map((k) => `${PARAM_LABEL[k]} ${own[k]}`)
      .join(" · ");
    return (
      <div
        key={m.id}
        className="op-chip"
        draggable={canEdit}
        title={canEdit ? `${text || "as above"} — drag it into another operational mode` : text || "as above"}
        onDragStart={(e) => {
          e.dataTransfer.setData(MODE_DRAG, m.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => setDropOn(null)}
      >
        <Link to={`/emitters/${emitterId}?tab=modes&mode=${encodeURIComponent(m.name)}`} draggable={false}>
          {m.name}
        </Link>
        {text && <span className="op-chip-params">{text}</span>}
      </div>
    );
  };

  const container = (node: TreeNode): ReactNode => {
    if (onlyGaps && !gaps(node)) return null;
    const open = !collapsed.has(node.op.id);
    const scan = node.scanId ? scanById.get(node.scanId) : undefined;
    const own = node.op.scan_id === node.scanId;
    return (
      <div
        key={node.op.id}
        className={`op-box depth-${Math.min(node.depth, 3)}${dropOn === node.op.id ? " drop" : ""}`}
        aria-label={`Operational mode ${node.path}`}
        role="group"
        {...dropProps(node.op.id)}
      >
        <div className="op-box-head">
          <button
            type="button"
            className="op-toggle"
            aria-expanded={open}
            aria-label={`${open ? "Fold" : "Open"} ${node.op.name}`}
            onClick={() => setCollapsed((s) => toggle(s, node.op.id))}
          >
            {open ? "▾" : "▸"}
          </button>
          <strong className="op-box-name">{node.op.name}</strong>
          <span className="hint-text">
            {node.allModes.length} Mode{node.allModes.length === 1 ? "" : "s"}
          </span>
          <span className="op-box-tools">
            {scan && (
              <span className="op-box-meta" title={`${patternName(scan.pattern)}${own ? "" : ` — from ${node.scanFrom}`}`}>
                ⟳ {scanLine(scan)}
                {!own ? ` · ${node.scanFrom}` : ""}
              </span>
            )}
            {commentButton(node.op.id, node.path)}
            <RequireRole minimum="editor">
              <MenuButton label="⋯" className="row-menu-button" ariaLabel={`Actions for ${node.op.name}`} items={nodeMenuItems(node)} />
            </RequireRole>
          </span>
        </div>
        {node.op.description && <p className="op-box-description">{node.op.description}</p>}
        {Object.keys(node.shownHere).length > 0 && (
          <div className="op-box-section">
            <span className="op-box-label">Its Modes share</span>
            <Params values={node.shownHere} />
          </div>
        )}
        {coverage.has(node.op.id) || Object.keys(effectivePlan(node, byId).from).length ? (
          <div className="op-box-section">
            <span className="op-box-label">Plan</span>
            {planCell(node)}
          </div>
        ) : null}
        {open && (node.children.length > 0 || node.modes.length > 0) && (
          <>
            {node.children.length > 0 && <div className="op-box-children">{node.children.map(container)}</div>}
            {node.modes.length > 0 && !onlyGaps && <div className="op-box-modes">{node.modes.map((m) => modeChip(m, node))}</div>}
          </>
        )}
        {open && !node.children.length && !node.modes.length && (
          <p className="hint-text op-box-empty">{canEdit ? "Drag Modes in here, or add one under it." : "No Modes yet."}</p>
        )}
      </div>
    );
  };

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
        <Params values={ownParams(m, node, scanOf(m))} empty={<span className="hint-text">as above</span>} />
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
    // What it takes from above: a parameter it plans none of (PW paired with PRI comes with the PRI).
    const plansOwn = (k: (typeof PLAN_PARAMS)[number]) =>
      k === "pri" ? !!(own?.pri?.length || own?.pri_stagger?.length) : k === "pw" ? !!(own?.pw?.length || own?.pri_pw_paired) : !!own?.[k]?.length;
    const inherited = PLAN_PARAMS.filter((k) => !plansOwn(k) && cov?.plan.from[k]);
    if (!cov) {
      const eff = effectivePlan(node, byId);
      const from = [...new Set(Object.values(eff.from))];
      return from.length ? <span className="hint-text">plan from {from.join(", ")}</span> : null;
    }
    const open = openGaps.has(node.op.id);
    return (
      <div className="op-plan">
        <span className="op-params">
          {cov.chips.map((c) => (
            <span
              key={c.key}
              className={c.covered ? "op-param op-planned covered" : "op-param op-planned uncovered"}
              title={`${c.covered ? "A Mode under it covers it" : "No Mode under it covers it"}${c.note ? ` — ${c.note}` : ""}`}
            >
              <span className="op-param-label">{c.label}</span> {c.text} {c.covered ? "✓" : "⚠"}
              {c.note ? " ✎" : ""}
            </span>
          ))}
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

  /** Each operational mode's ⋯ menu — the same in the table and the containers. */
  const nodeMenuItems = (node: TreeNode) => [
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
                    // With no Modes under it yet, it makes them from values given (or its plan).
                    label: node.allModes.length
                      ? `Set on its ${node.allModes.length} Mode${node.allModes.length === 1 ? "" : "s"}…`
                      : "Make Modes from values…",
                    disabled: !canEdit,
                    title: editTitle,
                    onSelect: () => setSetting(node),
                  },
                  { label: "Delete…", danger: true, disabled: !canEdit, title: editTitle, onSelect: () => void remove(node) },
                ];

  const nodeRows = (node: TreeNode): ReactNode => {
    if (onlyGaps && !gaps(node)) return null;
    const open = !collapsed.has(node.op.id);
    const scan = node.scanId ? scanById.get(node.scanId) : undefined;
    const own = node.op.scan_id === node.scanId;
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
            {scan ? (
              <span title={patternName(scan.pattern)}>
                {scanLine(scan)}
                {!own && <span className="jitter-subline">from {node.scanFrom}</span>}
              </span>
            ) : (
              <span className="hint-text">—</span>
            )}
          </td>
          <td className="row-actions op-actions">
            {commentButton(node.op.id, node.path)}
            <RequireRole minimum="editor">
              <MenuButton
                label="⋯"
                className="row-menu-button"
                ariaLabel={`Actions for ${node.op.name}`}
                items={nodeMenuItems(node)}
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
        value to every Mode under one. Each takes a <strong>scan</strong> (from the Scans card): its Modes and the ones under it
        take it unless they have their own — the dwell planner works out their illumination time and revisit from it. <strong>Move up / down</strong> orders them. Not exported.
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
        <span className="op-view-switch" role="group" aria-label="View">
          {(["table", "containers"] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={view === v ? "button primary small" : "button secondary small"}
              aria-pressed={view === v}
              onClick={() => chooseView(v)}
            >
              {v === "table" ? "Table" : "Containers"}
            </button>
          ))}
        </span>
        <button type="button" className="button secondary small" onClick={() => setCommentsOn({ opId: null, title: "Notes on the whole plan" })}>
          Plan notes{planNotes.total ? ` (${planNotes.total}${planNotes.open ? `, ${planNotes.open} open` : ""})` : ""}
        </button>
      </div>
      {view === "containers" && moveError && <p className="error-text">{moveError}</p>}
      {view === "table" && canEdit && selected.size > 0 && (
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
      {view === "containers" && (roots.length > 0 || unlinked.length > 0) ? (
        <div className="op-boxes">
          {roots.map(container)}
          {(unlinked.length > 0 || canEdit) && !onlyGaps && (
            <div
              className={`op-box op-box-unlinked${dropOn === "none" ? " drop" : ""}`}
              role="group"
              aria-label="Not in an operational mode"
              {...dropProps("none")}
            >
              <div className="op-box-head">
                <strong className="op-box-name">Not in an operational mode</strong>
                <span className="hint-text">
                  {unlinked.length} Mode{unlinked.length === 1 ? "" : "s"}
                </span>
              </div>
              {unlinked.length ? (
                <div className="op-box-modes">{unlinked.map((m) => modeChip(m, null))}</div>
              ) : (
                <p className="hint-text op-box-empty">Drag a Mode here to take it out of its operational mode.</p>
              )}
            </div>
          )}
        </div>
      ) : !roots.length && !unlinked.length ? (
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
                <th>Scan · illumination, revisit</th>
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
          scans={scans ?? []}
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
