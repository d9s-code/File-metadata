import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { mdfCoverageApi, platformCoverageApi, type CoverageMode, type EmitterCoverage } from "../../api/platforms";
import { fmt, niceTicks, useWidth } from "../intercepts/charts/Histogram";
import { SERIES_SLOTS } from "../modes/charts/modeRanges";

type Span = [number, number];
type Param = "rf" | "pri" | "pw";

const PARAMS: { key: Param; label: string; unit: string }[] = [
  { key: "rf", label: "RF", unit: "MHz" },
  { key: "pri", label: "PRI / frame time", unit: "µs" },
  { key: "pw", label: "PW", unit: "µs" },
];

const ROW = 20;
const HEAD = 28;
const LABEL_W = 230;
const PAD_R = 16;


function spanOf(m: CoverageMode, p: Param, engineered: boolean): Span | null {
  if (p === "rf") return engineered ? m.rf : m.rf_raw;
  if (p === "pri") return engineered ? m.pri : m.pri_raw;
  return engineered ? m.pw : m.pw_raw;
}

/** The ranges an Emitter covers on one parameter: its Modes' ranges joined
 * where they overlap or touch, and kept apart where they don't — 1–2 and
 * 200–205 µs stay two pieces, never 1–205. */
export function coveredRanges(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: Span[] = [];
  for (const [lo, hi] of sorted) {
    const last = out[out.length - 1];
    if (last && lo <= last[1]) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

function emitterLabel(e: EmitterCoverage) {
  return e.designation ? `${e.designation} — ${e.emitter_name}` : e.emitter_name;
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function rangeText(spans: Span[], unit: string) {
  return spans.map(([lo, hi]) => (lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`)).join(", ") + ` ${unit}`;
}

interface Row {
  /** A line with bars; or a heading over the lines below it. */
  kind: "line" | "heading";
  depth: number;
  label: string;
  title: string;
  colour: number;
  spans: Span[];
}

/** A Platform, Emitter or Mode in the charts' tree, with every Mode under it. */
export interface CoverageNode {
  key: string;
  label: string;
  title: string;
  modes: CoverageMode[];
  children?: CoverageNode[];
}

/** The charts' lines at a level of the tree: a line per node at that depth,
 * under headings for the nodes above it. */
function rowsAt(
  nodes: CoverageNode[],
  level: number,
  p: Param,
  engineered: boolean,
  colours: Map<string, number>,
  colourDepth: number,
): Row[] {
  const out: Row[] = [];
  const walk = (node: CoverageNode, depth: number, colour: number) => {
    const c = depth === colourDepth ? (colours.get(node.key) ?? colour) : colour;
    if (depth === level || !node.children?.length) {
      const spans = node.modes.map((m) => spanOf(m, p, engineered)).filter((s): s is Span => !!s);
      out.push({ kind: "line", depth, label: node.label, title: node.title, colour: c, spans: coveredRanges(spans) });
      return;
    }
    out.push({ kind: "heading", depth, label: node.label, title: node.title, colour: c, spans: [] });
    for (const child of node.children) walk(child, depth + 1, c);
  };
  nodes.forEach((n) => walk(n, 0, colours.get(n.key) ?? 0));
  return out;
}

/** The nodes at a depth of the tree, in order. */
function nodesAt(nodes: CoverageNode[], depth: number): CoverageNode[] {
  return depth === 0 ? nodes : nodes.flatMap((n) => nodesAt(n.children ?? [], depth - 1));
}

function ParamChart({
  param,
  rows,
  log,
}: {
  param: (typeof PARAMS)[number];
  rows: Row[];
  log: boolean;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const all = rows.flatMap((r) => r.spans);
  const useLog = log && all.length > 0 && all.every(([lo]) => lo > 0);
  const t = (v: number) => (useLog ? Math.log10(v) : v);
  let lo = Math.min(...all.map((s) => t(s[0])));
  let hi = Math.max(...all.map((s) => t(s[1])));
  if (!Number.isFinite(lo)) [lo, hi] = [0, 1];
  const pad = (hi - lo) * 0.04 || Math.max(Math.abs(lo) * 0.01, 0.5);
  lo -= pad;
  hi += pad;
  const plotW = Math.max(80, width - LABEL_W - PAD_R);
  const x = (v: number) => LABEL_W + ((t(v) - lo) / (hi - lo || 1)) * plotW;
  const ticks = useLog
    ? Array.from({ length: Math.floor(hi) - Math.ceil(lo) + 1 }, (_, i) => 10 ** (Math.ceil(lo) + i))
    : niceTicks(lo, hi);
  const height = HEAD + rows.length * ROW + 8;

  return (
    <div className="viz-card platform-chart">
      <div className="viz-card-header">
        <strong>
          {param.label} <span className="hint-text">({param.unit})</span>
        </strong>
        {log && !useLog && <span className="hint-text">no log scale: a value at or below 0</span>}
      </div>
      <div ref={ref}>
        {width > 0 && rows.length > 0 && (
          <svg width={width} height={height} role="img" aria-label={`${param.label} coverage`}>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={x(v)} x2={x(v)} y1={HEAD - 6} y2={height - 4} className="viz-gridline" />
                <text x={x(v)} y={HEAD - 10} textAnchor="middle" className="viz-axis-label">
                  {fmt(v)}
                </text>
              </g>
            ))}
            {rows.map((r, i) => {
              const y = HEAD + i * ROW;
              return (
                <g key={i}>
                  <title>{`${r.title}\n${r.spans.length ? rangeText(r.spans, param.unit) : "nothing on this parameter"}`}</title>
                  {i % 2 === 0 && <rect x={0} y={y} width={width} height={ROW} className="platform-chart-band" />}
                  <text
                    x={4 + r.depth * 14}
                    y={y + ROW / 2 + 4}
                    className={r.kind === "heading" || r.depth === 0 ? "platform-chart-label emitter" : "platform-chart-label"}
                  >
                    {truncate(r.label, 32 - r.depth * 2)}
                  </text>
                  {r.spans.map(([a, b], j) => (
                    <rect
                      key={j}
                      x={x(a)}
                      y={y + 4}
                      width={Math.max(2, x(b) - x(a))}
                      height={ROW - 8}
                      rx={2}
                      className="platform-chart-bar"
                      style={{ fill: r.colour < SERIES_SLOTS ? `var(--series-${r.colour + 1})` : "var(--muted)" }}
                    />
                  ))}
                  {r.spans.length === 0 && r.kind === "line" && (
                    <text x={LABEL_W + 4} y={y + ROW / 2 + 4} className="hint-text platform-chart-none">
                      —
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}

/** RF, PRI and PW coverage of a tree of Platforms, Emitters and Modes: a
 * line per node at the chosen level — its Modes' ranges joined only where
 * they overlap, so a gap stays a gap — under headings for the levels above. */
export function CoverageCharts({
  nodes,
  levels,
  storageKey,
  note,
  legend,
}: {
  nodes: CoverageNode[];
  /** The tree's levels, top first, e.g. ["Platform", "Emitter", "Mode"]. */
  levels: string[];
  storageKey: string;
  /** What the lines come from, e.g. "As of each pinned version." */
  note: string;
  legend: ReactNode;
}) {
  const [level, setLevelState] = useState(() => {
    try {
      const v = Number(localStorage.getItem(storageKey));
      return Number.isInteger(v) && v >= 0 && v < levels.length ? v : 0;
    } catch {
      return 0;
    }
  });
  const setLevel = (v: number) => {
    setLevelState(v);
    try {
      localStorage.setItem(storageKey, String(v));
    } catch {
      /* not remembered */
    }
  };
  const [engineered, setEngineered] = useState(true);
  const [log, setLog] = useState(false);
  // Bars are coloured by what the lines are, or (for Modes) what they're under.
  const colourDepth = Math.max(0, Math.min(level, levels.length - 2));
  const coloured = useMemo(() => nodesAt(nodes, colourDepth), [nodes, colourDepth]);
  const colours = useMemo(() => new Map(coloured.map((n, i) => [n.key, i])), [coloured]);
  const rowsFor = useMemo(
    () => (p: Param) => rowsAt(nodes, level, p, engineered, colours, colourDepth),
    [nodes, level, engineered, colours, colourDepth],
  );

  return (
    <div className="platform-charts">
      <div className="platform-charts-controls">
        <div className="theme-toggle" role="group" aria-label="Chart lines">
          {levels.map((name, i) => (
            <button key={name} type="button" className={level === i ? "active" : undefined} onClick={() => setLevel(i)}>
              Per {name}
            </button>
          ))}
        </div>
        <label className="inline-label">
          <input type="checkbox" checked={engineered} onChange={(e) => setEngineered(e.target.checked)} /> Engineered
          values
        </label>
        <label className="inline-label">
          <input type="checkbox" checked={log} onChange={(e) => setLog(e.target.checked)} /> Log scale
        </label>
        <span className="hint-text">
          {level < levels.length - 1
            ? `One line per ${levels[level]}: its Modes' ranges, joined only where they overlap — a gap is a value no Mode covers.`
            : `One line per Mode, under its ${levels[level - 1] ?? "group"}.`}{" "}
          {note}
        </span>
      </div>
      {PARAMS.map((p) => (
        <ParamChart key={p.key} param={p} rows={rowsFor(p.key)} log={log} />
      ))}
      <p className="hint-text">
        {coloured.map((n, i) => (
          <span key={n.key} className="platform-chart-legend">
            <Swatch i={i} />
            {n.title}
          </span>
        ))}
      </p>
      <p className="hint-text">{legend}</p>
    </div>
  );
}

function Swatch({ i }: { i: number }) {
  return (
    <span
      className="platform-chart-swatch"
      style={{ background: i < SERIES_SLOTS ? `var(--series-${i + 1})` : "var(--muted)" }}
    />
  );
}

function emitterNode(e: EmitterCoverage, keyPrefix = ""): CoverageNode {
  const label = emitterLabel(e);
  const title = `${label} (v${e.version_number})`;
  return {
    key: `${keyPrefix}${e.emitter_id}`,
    label,
    title,
    modes: e.modes,
    children: e.modes.map((m, i) => ({ key: `${keyPrefix}${e.emitter_id}:${i}`, label: m.name, title: `${m.name} — ${title}`, modes: [m] })),
  };
}

/** What a Platform's pinned Emitter versions cover: per Emitter or per Mode. */
export function PlatformCharts({ platformId }: { platformId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["platform-coverage", platformId],
    queryFn: () => platformCoverageApi.get(platformId),
  });
  const nodes = useMemo(() => (data ?? []).map((e) => emitterNode(e)), [data]);
  if (isLoading) return <p className="hint-text">Loading what the Emitters cover…</p>;
  if (!data?.length) return <p className="hint-text">Pin an Emitter version to see what this Platform covers.</p>;
  return (
    <CoverageCharts
      nodes={nodes}
      levels={["Emitter", "Mode"]}
      storageKey="platformChartLevel"
      note="As of each pinned version."
      legend={data.map((e) => (
        <span key={e.emitter_id} className="platform-chart-legend">
          <Link to={`/emitters/${e.emitter_id}`}>{emitterLabel(e)}</Link> · {e.modes.length} Mode
          {e.modes.length === 1 ? "" : "s"}
        </span>
      ))}
    />
  );
}

/** What an MDF's pinned Platform versions cover: per Platform, per Emitter
 * (under its Platform) or per Mode. */
export function MdfCharts({ mdfId }: { mdfId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["mdf-coverage", mdfId],
    queryFn: () => mdfCoverageApi.get(mdfId),
  });
  const nodes = useMemo(
    () =>
      (data ?? []).map((p): CoverageNode => {
        const title = `${p.platform_name} (v${p.version_number})`;
        const emitters = p.emitters.map((e) => emitterNode(e, `${p.platform_id}:`));
        return { key: p.platform_id, label: p.platform_name, title, modes: p.emitters.flatMap((e) => e.modes), children: emitters };
      }),
    [data],
  );
  if (isLoading) return <p className="hint-text">Loading what the Platforms cover…</p>;
  if (!data?.length) return <p className="hint-text">Pin a Platform version to see what this MDF covers.</p>;
  return (
    <CoverageCharts
      nodes={nodes}
      levels={["Platform", "Emitter", "Mode"]}
      storageKey="mdfChartLevel"
      note="As of each pinned Platform version and the Emitter versions it pins."
      legend={data.map((p) => (
        <span key={p.platform_id} className="platform-chart-legend">
          <Link to={`/platforms/${p.platform_id}`}>{p.platform_name}</Link> · {p.emitters.length}{" "}
          Emitter{p.emitters.length === 1 ? "" : "s"}
        </span>
      ))}
    />
  );
}
