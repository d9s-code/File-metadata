/** The radar as a tree: its operational modes (TRACK → Track 1, 2, 3…) with
 * the Modes under each, and each parameter shown at the highest level where
 * everything below agrees — the RF range Track 1–3 share on TRACK, the PRI
 * that differs on each Mode. Pure, so it can be tested on its own. */
import type { OperationalMode } from "../../api/operationalModes";
import type { Mode } from "../../types/domain";
import { priTypeLabel } from "../modes/modeFormat";

/** The parameters a radar is described by, in the order they're shown. */
export const PARAMS = ["pri_type", "rf", "pri", "jitter", "pw", "scan"] as const;
export type ParamKey = (typeof PARAMS)[number];
export const PARAM_LABEL: Record<ParamKey, string> = {
  pri_type: "PRI type",
  rf: "RF",
  pri: "PRI",
  jitter: "Jitter",
  pw: "PW",
  scan: "Scan",
};

const n = (v: number) => String(Number(v.toFixed(4)));
const range = (lo: number | null | undefined, hi: number | null | undefined, unit: string, delta?: number | null) => {
  if (lo == null && hi == null) return null;
  const a = lo ?? hi!;
  const b = hi ?? lo!;
  return `${a === b ? n(a) : `${n(a)}–${n(b)}`} ${unit}${delta ? ` ±${n(delta)}` : ""}`;
};

/** A Mode's value for each parameter, as shown ("—": it has none — a CW's PRI, say). */
export function modeParams(m: Mode): Record<ParamKey, string> {
  const l = m.line;
  const none = "—";
  const pri =
    m.pri_type === "fixed"
      ? range(l?.pri_min_us, l?.pri_max_us, "µs", l?.pri_delta)
      : m.pri_type === "stagger" && l?.pri_stagger_values_us?.length
        ? `${l.pri_stagger_values_us.map(n).join("/")} µs`
        : null;
  const jitter = m.pri_type === "fixed" && (l?.jitter_max_us || l?.jitter_min_us) ? range(l?.jitter_min_us, l?.jitter_max_us, "µs", l?.jitter_delta) : null;
  return {
    pri_type: priTypeLabel(m.pri_type),
    rf: (l && range(l.rf_min_mhz, l.rf_max_mhz, "MHz", l.rf_delta)) ?? none,
    pri: pri ?? none,
    jitter: jitter ?? none,
    pw: (l && range(l.pw_min_us, l.pw_max_us, "µs", l.pw_delta)) ?? none,
    scan: range(m.scan_min_s, m.scan_max_s, "s") ?? none,
  };
}

export interface TreeNode {
  op: OperationalMode;
  depth: number;
  /** "TRACK › Track 2". */
  path: string;
  children: TreeNode[];
  /** Linked to it directly. */
  modes: Mode[];
  /** It and everything below it. */
  allModes: Mode[];
  /** Parameters every Mode below agrees on, with the value. */
  shared: Partial<Record<ParamKey, string>>;
  /** …of those, the ones not already shown on its parent — shown here. */
  shownHere: Partial<Record<ParamKey, string>>;
  /** The illumination time its Modes take, ms: its own, else the nearest above it with one (null: none in the tree). */
  illuminationMs: number | null;
  /** The operational mode that's from (it, or one above it). */
  illuminationFrom: string | null;
  /** The scan period its Modes take, s, unless one has its own box: its own, else the nearest above it with one. */
  scanS: [number, number] | null;
  scanFrom: string | null;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true });

function sharedOf(modes: Mode[]): Partial<Record<ParamKey, string>> {
  if (!modes.length) return {};
  const all = modes.map(modeParams);
  const out: Partial<Record<ParamKey, string>> = {};
  // All "—" (none has one) counts as shared too, so it isn't repeated on each Mode — and isn't shown.
  for (const k of PARAMS) if (all.every((p) => p[k] === all[0][k])) out[k] = all[0][k];
  return out;
}

/** The tree, sorted (siblings by their order, then by name, numbers as numbers), and the Modes linked to none. */
export function buildTree(ops: OperationalMode[], modes: Mode[]): { roots: TreeNode[]; unlinked: Mode[]; byId: Map<string, TreeNode> } {
  const ids = new Set(ops.map((o) => o.id));
  const kids = new Map<string | null, OperationalMode[]>();
  for (const o of ops) {
    // A parent that isn't there (or a loop) puts it at the top.
    const parent = o.parent_id && ids.has(o.parent_id) && o.parent_id !== o.id ? o.parent_id : null;
    kids.set(parent, [...(kids.get(parent) ?? []), o]);
  }
  const linked = new Map<string, Mode[]>();
  const unlinked: Mode[] = [];
  for (const m of [...modes].sort(byName)) {
    if (m.operational_mode_id && ids.has(m.operational_mode_id)) linked.set(m.operational_mode_id, [...(linked.get(m.operational_mode_id) ?? []), m]);
    else unlinked.push(m);
  }
  const byId = new Map<string, TreeNode>();
  const seen = new Set<string>();

  function build(o: OperationalMode, depth: number, parent: TreeNode | null): TreeNode {
    seen.add(o.id);
    const node: TreeNode = {
      op: o,
      depth,
      path: parent ? `${parent.path} › ${o.name}` : o.name,
      children: [],
      modes: linked.get(o.id) ?? [],
      allModes: [],
      shared: {},
      shownHere: {},
      illuminationMs: o.illumination_time_ms ?? parent?.illuminationMs ?? null,
      illuminationFrom: o.illumination_time_ms != null ? o.name : (parent?.illuminationFrom ?? null),
      scanS: o.scan_min_s != null && o.scan_max_s != null ? [o.scan_min_s, o.scan_max_s] : (parent?.scanS ?? null),
      scanFrom: o.scan_min_s != null && o.scan_max_s != null ? o.name : (parent?.scanFrom ?? null),
    };
    byId.set(o.id, node);
    const children = [...(kids.get(o.id) ?? [])].filter((c) => !seen.has(c.id));
    children.sort((a, b) => a.sort_order - b.sort_order || byName(a, b));
    node.children = children.map((c) => build(c, depth + 1, node));
    node.allModes = [...node.modes, ...node.children.flatMap((c) => c.allModes)];
    return node;
  }
  const tops = [...(kids.get(null) ?? [])].sort((a, b) => a.sort_order - b.sort_order || byName(a, b));
  const roots = tops.map((o) => build(o, 0, null));
  // Anything only reachable through a loop: at the top.
  for (const o of ops) if (!seen.has(o.id)) roots.push(build(o, 0, null));

  function factor(node: TreeNode, parentShared: Partial<Record<ParamKey, string>>) {
    node.shared = sharedOf(node.allModes);
    node.shownHere = Object.fromEntries(
      Object.entries(node.shared).filter(([k, v]) => v !== "—" && parentShared[k as ParamKey] !== v),
    ) as Partial<Record<ParamKey, string>>;
    node.children.forEach((c) => factor(c, node.shared));
  }
  roots.forEach((r) => factor(r, {}));
  return { roots, unlinked, byId };
}

/** A Mode's own parameters: those its operational mode's Modes don't all share. */
export function ownParams(m: Mode, node: TreeNode | null): Partial<Record<ParamKey, string>> {
  const p = modeParams(m);
  // Not in one: what it has (a "—" says nothing there).
  return Object.fromEntries(PARAMS.filter((k) => (node ? node.shared[k] === undefined : p[k] !== "—")).map((k) => [k, p[k]])) as Partial<
    Record<ParamKey, string>
  >;
}

/** The tree flattened in display order, each with its depth — for a picker. */
export function flatten(roots: TreeNode[]): TreeNode[] {
  return roots.flatMap((r) => [r, ...flatten(r.children)]);
}

/** It and every operational mode under it. */
export function below(node: TreeNode): Set<string> {
  return new Set(flatten([node]).map((x) => x.op.id));
}
