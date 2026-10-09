import { useEffect, useId, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { mdfCoverageApi, platformCoverageApi, type CoverageMode, type EmitterCoverage } from "../../api/platforms";
import { fmt, niceTicks, useWidth } from "../intercepts/charts/Histogram";
import { SERIES_SLOTS } from "../modes/charts/modeRanges";
import type { AmbiguityFinding, AmbiguityRun, AmbiguityScopeType } from "../../api/ambiguity";
import { useAmbiguityFindings, useAmbiguityRuns } from "../../state/hooks/useAmbiguity";
import { SEVERITY_LABEL } from "../ambiguity/ambiguityText";

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
// Vertical bars: the value axis runs up a fixed height, the lines run across.
const PLOT_H = 300;
const PLOT_TOP = 12;
const AXIS_W = 76;
const COL_MIN = 22;
const COL_MAX = 56;
const LABEL_H = 130;

export type Orientation = "horizontal" | "vertical";
export type ChartLayout = "stacked" | "side";

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

/** A stretch of a line flagged on top of its bars, e.g. where it overlaps
 * another Emitter's Mode. */
export interface ChartMark {
  span: Span;
  title: string;
}

interface Row {
  /** A line with bars; or a heading over the lines below it. */
  kind: "line" | "heading";
  depth: number;
  label: string;
  title: string;
  colour: number;
  spans: Span[];
  marks: ChartMark[];
}

/** A Platform, Emitter or Mode in the charts' tree, with every Mode under it. */
export interface CoverageNode {
  key: string;
  label: string;
  title: string;
  modes: CoverageMode[];
  children?: CoverageNode[];
  /** Stretches to flag on this node's line (and the lines above it). */
  marks?: Partial<Record<Param, ChartMark[]>>;
  /** For a Mode: "emitter id:mode id", to find it in an ambiguity check's findings. */
  modeRef?: string;
}

/** The latest finished ambiguity check of a Platform or MDF, and its findings
 * between Modes of different Emitters that haven't been merged away. */
function useLatestAmbiguity(scopeType: AmbiguityScopeType, scopeId: string) {
  const { data: runs } = useAmbiguityRuns(scopeType, scopeId);
  const run = runs?.find((r) => r.status === "complete") ?? null;
  const { data } = useAmbiguityFindings(run?.id ?? null);
  const findings = useMemo(
    () =>
      (data ?? []).filter(
        (f) => !f.resolution && f.details.mode_a.emitter_id !== f.details.mode_b.emitter_id,
      ),
    [data],
  );
  return { run, findings };
}

function intersect(a: Span | null, b: Span | null): Span | null {
  if (!a || !b) return null;
  const lo = Math.max(a[0], b[0]);
  const hi = Math.min(a[1], b[1]);
  return lo <= hi ? [lo, hi] : null;
}

/** The tree with every flagged Mode's overlap with the other Mode marked on
 * its line — where the two Modes' ranges meet, on each parameter. */
function withAmbiguityMarks(nodes: CoverageNode[], findings: AmbiguityFinding[], engineered: boolean): CoverageNode[] {
  const modes = new Map<string, { mode: CoverageMode; emitter: string }>();
  const collect = (n: CoverageNode, emitter: string) => {
    if (n.modeRef && n.modes[0]) modes.set(n.modeRef, { mode: n.modes[0], emitter });
    n.children?.forEach((c) => collect(c, n.modeRef ? emitter : n.label));
  };
  nodes.forEach((n) => collect(n, n.label));
  const against = new Map<string, { other: string; finding: AmbiguityFinding }[]>();
  for (const f of findings) {
    const a = `${f.details.mode_a.emitter_id}:${f.mode_id_a}`;
    const b = `${f.details.mode_b.emitter_id}:${f.mode_id_b}`;
    against.set(a, [...(against.get(a) ?? []), { other: b, finding: f }]);
    against.set(b, [...(against.get(b) ?? []), { other: a, finding: f }]);
  }
  const mark = (n: CoverageNode): CoverageNode => {
    const children = n.children?.map(mark);
    const mine = n.modeRef ? modes.get(n.modeRef) : undefined;
    if (!mine || !n.modeRef) return { ...n, children };
    const marks: Partial<Record<Param, ChartMark[]>> = {};
    for (const { other, finding } of against.get(n.modeRef) ?? []) {
      const theirs = modes.get(other);
      if (!theirs) continue; // Not pinned here any more.
      const title = `${mine.mode.name} overlaps ${theirs.mode.name} (${theirs.emitter}) — ${SEVERITY_LABEL[finding.combined_severity]}`;
      for (const { key: p } of PARAMS) {
        const span = intersect(spanOf(mine.mode, p, engineered), spanOf(theirs.mode, p, engineered));
        if (span) (marks[p] ??= []).push({ span, title });
      }
    }
    return { ...n, children, marks };
  };
  return nodes.map(mark);
}

/** A node's own marks on a parameter and those of everything under it,
 * joined where they overlap (the hover lists every overlap in the stretch). */
function marksUnder(node: CoverageNode, p: Param): ChartMark[] {
  const all = [...(node.marks?.[p] ?? []), ...(node.children ?? []).flatMap((c) => marksUnder(c, p))];
  const out: { span: Span; titles: Set<string> }[] = [];
  for (const m of [...all].sort((a, b) => a.span[0] - b.span[0])) {
    const last = out[out.length - 1];
    if (last && m.span[0] <= last.span[1]) {
      last.span = [last.span[0], Math.max(last.span[1], m.span[1])];
      last.titles.add(m.title);
    } else out.push({ span: [...m.span], titles: new Set([m.title]) });
  }
  return out.map((m) => ({ span: m.span, title: [...m.titles].join("\n") }));
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
      out.push({
        kind: "line",
        depth,
        label: node.label,
        title: node.title,
        colour: c,
        spans: coveredRanges(spans),
        marks: marksUnder(node, p),
      });
      return;
    }
    out.push({ kind: "heading", depth, label: node.label, title: node.title, colour: c, spans: [], marks: [] });
    for (const child of node.children) walk(child, depth + 1, c);
  };
  nodes.forEach((n) => walk(n, 0, colours.get(n.key) ?? 0));
  return out;
}

/** The nodes at a depth of the tree, in order. */
function nodesAt(nodes: CoverageNode[], depth: number): CoverageNode[] {
  return depth === 0 ? nodes : nodes.flatMap((n) => nodesAt(n.children ?? [], depth - 1));
}

/** Ticks across a window of the value axis (log windows are in decades). */
function ticksFor(s0: number, s1: number, useLog: boolean): number[] {
  if (!useLog) return niceTicks(s0, s1);
  if (s1 - s0 < 1.5) return niceTicks(10 ** s0, 10 ** s1).filter((v) => v > 0);
  const step = Math.ceil((Math.floor(s1) - Math.ceil(s0) + 1) / 8);
  const out: number[] = [];
  for (let e = Math.ceil(s0); e <= s1; e += step) out.push(10 ** e);
  return out;
}

/** Keep a zoomed window inside the whole axis; null once it shows it all. */
function clampView(v: Span, full: Span): Span | null {
  const fullSpan = full[1] - full[0];
  const span = Math.max(v[1] - v[0], fullSpan / 5000);
  if (span >= fullSpan * 0.999) return null;
  const a = Math.max(full[0], Math.min(v[0], full[1] - span));
  return [a, a + span];
}

function ParamChart({
  param,
  rows,
  log,
  orientation,
}: {
  param: (typeof PARAMS)[number];
  rows: Row[];
  log: boolean;
  orientation: Orientation;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const clipId = `pc-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const all = rows.flatMap((r) => r.spans);
  const useLog = log && all.length > 0 && all.every(([lo]) => lo > 0);
  const t = (v: number) => (useLog ? Math.log10(v) : v);
  let lo = Math.min(...all.map((s) => t(s[0])));
  let hi = Math.max(...all.map((s) => t(s[1])));
  if (!Number.isFinite(lo)) [lo, hi] = [0, 1];
  const pad = (hi - lo) * 0.04 || Math.max(Math.abs(lo) * 0.01, 0.5);
  const full: Span = [lo - pad, hi + pad];

  // The zoomed window, in axis units; dropped when the axis itself changes.
  const fullKey = `${full[0]}:${full[1]}:${useLog}`;
  const [zoom, setZoom] = useState<{ key: string; view: Span } | null>(null);
  const view = zoom?.key === fullKey ? zoom.view : null;
  const [s0, s1] = view ?? full;
  const setView = (v: Span | null) => {
    const next = v && clampView(v, full);
    setZoom(next ? { key: fullKey, view: next } : null);
  };

  const horizontal = orientation === "horizontal";
  const labelW = Math.min(LABEL_W, Math.max(120, width * 0.35));
  const axisStart = horizontal ? labelW : PLOT_TOP;
  const axisLen = horizontal ? Math.max(80, width - labelW - PAD_R) : PLOT_H;
  const rowStart = horizontal ? HEAD : AXIS_W;
  const rowSize = horizontal
    ? ROW
    : Math.min(COL_MAX, Math.max(COL_MIN, (width - AXIS_W - PAD_R) / Math.max(1, rows.length)));
  const svgW = horizontal ? width : Math.max(width, AXIS_W + rows.length * rowSize + PAD_R);
  const svgH = horizontal ? HEAD + rows.length * ROW + 8 : PLOT_TOP + PLOT_H + LABEL_H;
  // Where a value sits along the value axis (vertical bars grow upwards).
  const pos = (v: number) => {
    const f = (t(v) - s0) / (s1 - s0 || 1);
    return horizontal ? axisStart + f * axisLen : axisStart + axisLen - f * axisLen;
  };
  const ticks = ticksFor(s0, s1, useLog);

  // Wheel zoom (with Ctrl/⌘, so scrolling the page still works) and drag to pan.
  const geo = useRef({ horizontal, axisStart, axisLen, s0, s1, setView });
  geo.current = { horizontal, axisStart, axisLen, s0, s1, setView };
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null);
  const [wheelHint, setWheelHint] = useState(false);
  useEffect(() => {
    if (!svgEl) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      const g = geo.current;
      const r = svgEl.getBoundingClientRect();
      const along = g.horizontal ? e.clientX - r.left - g.axisStart : g.axisStart + g.axisLen - (e.clientY - r.top);
      if (along < 0 || along > g.axisLen) return;
      if (!e.ctrlKey && !e.metaKey) {
        setWheelHint(true);
        clearTimeout(timer);
        timer = setTimeout(() => setWheelHint(false), 1500);
        return;
      }
      e.preventDefault();
      const anchor = g.s0 + (along / g.axisLen) * (g.s1 - g.s0);
      const f = e.deltaY > 0 ? 1.25 : 0.8;
      g.setView([anchor - (anchor - g.s0) * f, anchor + (g.s1 - anchor) * f]);
    };
    svgEl.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      svgEl.removeEventListener("wheel", onWheel);
      clearTimeout(timer);
    };
  }, [svgEl]);
  const drag = useRef<{ p0: number; view: Span } | null>(null);
  const [dragging, setDragging] = useState(false);
  const along = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return horizontal ? e.clientX - r.left : e.clientY - r.top;
  };
  const zoomBy = (f: number) => {
    const mid = (s0 + s1) / 2;
    setView([mid - ((s1 - s0) * f) / 2, mid + ((s1 - s0) * f) / 2]);
  };
  const shownText = (v: number) => fmt(useLog ? 10 ** v : v);

  const bar = (a: number, b: number, i: number) => {
    const p = pos(a);
    const q = pos(b);
    return horizontal
      ? { x: Math.min(p, q), y: rowStart + i * ROW + 4, width: Math.max(2, Math.abs(q - p)), height: ROW - 8 }
      : { x: rowStart + i * rowSize + 3, y: Math.min(p, q), width: Math.max(2, rowSize - 6), height: Math.max(2, Math.abs(q - p)) };
  };

  return (
    <div className="viz-card platform-chart">
      <div className="viz-card-header">
        <strong>
          {param.label} <span className="hint-text">({param.unit})</span>
        </strong>
        {log && !useLog && <span className="hint-text">no log scale: a value at or below 0</span>}
        <span className="platform-chart-zoom">
          {wheelHint ? (
            <span className="hint-text">Hold Ctrl (⌘ on a Mac) and scroll to zoom</span>
          ) : view ? (
            <span className="hint-text">
              Showing {shownText(s0)}–{shownText(s1)} {param.unit}
            </span>
          ) : null}
          <button type="button" className="button secondary small" onClick={() => zoomBy(0.5)} title="Zoom in" aria-label="Zoom in">
            +
          </button>
          <button type="button" className="button secondary small" disabled={!view} onClick={() => zoomBy(2)} title="Zoom out" aria-label="Zoom out">
            −
          </button>
          <button type="button" className="button secondary small" disabled={!view} onClick={() => setView(null)}>
            Show all
          </button>
        </span>
      </div>
      <div ref={ref} className={horizontal ? undefined : "platform-chart-scroll"}>
        {width > 0 && rows.length > 0 && (
          <svg
            ref={setSvgEl}
            width={svgW}
            height={svgH}
            role="img"
            aria-label={`${param.label} coverage`}
            className={dragging ? "platform-chart-svg dragging" : "platform-chart-svg"}
            onPointerDown={(e) => {
              const p = along(e);
              const inPlot = horizontal ? p >= axisStart : p >= axisStart && p <= axisStart + axisLen;
              if (!inPlot || e.button !== 0) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { p0: p, view: [s0, s1] };
              setDragging(true);
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              const moved = ((along(e) - d.p0) / axisLen) * (d.view[1] - d.view[0]);
              const shift = horizontal ? -moved : moved;
              setView([d.view[0] + shift, d.view[1] + shift]);
            }}
            onPointerUp={() => {
              drag.current = null;
              setDragging(false);
            }}
            onDoubleClick={() => setView(null)}
          >
            <defs>
              <pattern id={`${clipId}-hatch`} patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
                <line x1={0} y1={0} x2={0} y2={6} className="platform-chart-hatch" />
              </pattern>
              <clipPath id={clipId}>
                {horizontal ? (
                  <rect x={axisStart} y={0} width={axisLen + PAD_R} height={svgH} />
                ) : (
                  <rect x={0} y={axisStart} width={svgW} height={axisLen} />
                )}
              </clipPath>
            </defs>
            {rows.map((_, i) =>
              i % 2 === 0 ? (
                <rect
                  key={i}
                  className="platform-chart-band"
                  {...(horizontal
                    ? { x: 0, y: rowStart + i * ROW, width: svgW, height: ROW }
                    : { x: rowStart + i * rowSize, y: axisStart, width: rowSize, height: axisLen })}
                />
              ) : null,
            )}
            {ticks.map((v) => {
              const p = pos(v);
              if (p < axisStart - 0.5 || p > axisStart + axisLen + 0.5) return null;
              return horizontal ? (
                <g key={v}>
                  <line x1={p} x2={p} y1={HEAD - 6} y2={svgH - 4} className="viz-gridline" />
                  <text x={p} y={HEAD - 10} textAnchor="middle" className="platform-chart-tick">
                    {fmt(v)}
                  </text>
                </g>
              ) : (
                <g key={v}>
                  <line x1={AXIS_W - 4} x2={svgW} y1={p} y2={p} className="viz-gridline" />
                  <text x={AXIS_W - 6} y={p + 4} textAnchor="end" className="platform-chart-tick">
                    {fmt(v)}
                  </text>
                </g>
              );
            })}
            {rows.map((r, i) => {
              const labelClass =
                r.kind === "heading" || r.depth === 0 ? "platform-chart-label emitter" : "platform-chart-label";
              const cx = rowStart + i * rowSize + rowSize / 2;
              const ly = axisStart + axisLen + 10;
              return (
                <g key={i}>
                  <title>{`${r.title}\n${r.spans.length ? rangeText(r.spans, param.unit) : "nothing on this parameter"}`}</title>
                  {horizontal ? (
                    <text x={4 + r.depth * 14} y={rowStart + i * ROW + ROW / 2 + 4} className={labelClass}>
                      {truncate(r.label, Math.round(labelW / 7.2) - r.depth * 2)}
                    </text>
                  ) : (
                    <text x={cx} y={ly} textAnchor="end" transform={`rotate(-62 ${cx} ${ly})`} className={labelClass}>
                      {truncate(r.label, 22)}
                    </text>
                  )}
                  <g clipPath={`url(#${clipId})`}>
                    {r.spans.map(([a, b], j) => (
                      <rect
                        key={j}
                        {...bar(a, b, i)}
                        rx={2}
                        className="platform-chart-bar"
                        style={{ fill: r.colour < SERIES_SLOTS ? `var(--series-${r.colour + 1})` : "var(--muted)" }}
                      />
                    ))}
                    {r.marks.map((m, j) => (
                      <rect
                        key={`m${j}`}
                        {...bar(m.span[0], m.span[1], i)}
                        className="platform-chart-mark"
                        style={{ fill: `url(#${clipId}-hatch)` }}
                      >
                        <title>{m.title}</title>
                      </rect>
                    ))}
                  </g>
                  {r.spans.length === 0 && r.kind === "line" && (
                    <text
                      {...(horizontal
                        ? { x: axisStart + 4, y: rowStart + i * ROW + ROW / 2 + 4 }
                        : { x: cx, y: axisStart + axisLen - 6, textAnchor: "middle" as const })}
                      className="platform-chart-none"
                    >
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
  ambiguity,
}: {
  nodes: CoverageNode[];
  /** The tree's levels, top first, e.g. ["Platform", "Emitter", "Mode"]. */
  levels: string[];
  storageKey: string;
  /** What the lines come from, e.g. "As of each pinned version." */
  note: string;
  legend: ReactNode;
  /** The latest ambiguity check, to mark its overlaps on the lines. */
  ambiguity?: { run: AmbiguityRun | null; findings: AmbiguityFinding[]; link: string };
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
  const [orientation, setOrientation] = useRemembered<Orientation>("coverageChartOrientation", "horizontal", [
    "horizontal",
    "vertical",
  ]);
  const [layout, setLayout] = useRemembered<ChartLayout>("coverageChartLayout", "stacked", ["stacked", "side"]);
  // Bars are coloured by what the lines are, or (for Modes) what they're under.
  const colourDepth = Math.max(0, Math.min(level, levels.length - 2));
  const coloured = useMemo(() => nodesAt(nodes, colourDepth), [nodes, colourDepth]);
  const colours = useMemo(() => new Map(coloured.map((n, i) => [n.key, i])), [coloured]);
  const [showAmbiguity, setShowAmbiguity] = useState(false);
  const marked = useMemo(
    () => (showAmbiguity && ambiguity?.findings.length ? withAmbiguityMarks(nodes, ambiguity.findings, engineered) : nodes),
    [nodes, showAmbiguity, ambiguity, engineered],
  );
  const rowsFor = useMemo(
    () => (p: Param) => rowsAt(marked, level, p, engineered, colours, colourDepth),
    [marked, level, engineered, colours, colourDepth],
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
        <div className="theme-toggle" role="group" aria-label="Bar direction">
          <button
            type="button"
            className={orientation === "horizontal" ? "active" : undefined}
            onClick={() => setOrientation("horizontal")}
            title="A row per line, bars running left to right"
          >
            Horizontal bars
          </button>
          <button
            type="button"
            className={orientation === "vertical" ? "active" : undefined}
            onClick={() => setOrientation("vertical")}
            title="A column per line, bars running bottom to top"
          >
            Vertical bars
          </button>
        </div>
        <div className="theme-toggle" role="group" aria-label="Chart layout">
          <button
            type="button"
            className={layout === "stacked" ? "active" : undefined}
            onClick={() => setLayout("stacked")}
            title="RF, PRI and PW one under the other"
          >
            Stacked
          </button>
          <button
            type="button"
            className={layout === "side" ? "active" : undefined}
            onClick={() => setLayout("side")}
            title="RF, PRI and PW next to each other"
          >
            Side by side
          </button>
        </div>
        <label className="inline-label">
          <input type="checkbox" checked={engineered} onChange={(e) => setEngineered(e.target.checked)} /> Engineered
          values
        </label>
        <label className="inline-label">
          <input type="checkbox" checked={log} onChange={(e) => setLog(e.target.checked)} /> Log scale
        </label>
        {ambiguity && (
          <label
            className="inline-label"
            title={
              ambiguity.run
                ? "Mark where Modes of different Emitters overlap, from the latest ambiguity check"
                : "Run an ambiguity check first"
            }
          >
            <input
              type="checkbox"
              checked={showAmbiguity}
              disabled={!ambiguity.run}
              onChange={(e) => setShowAmbiguity(e.target.checked)}
            />{" "}
            Ambiguities
          </label>
        )}
        <span className="hint-text">
          {level < levels.length - 1
            ? `One line per ${levels[level]}: its Modes' ranges, joined only where they overlap — a gap is a value no Mode covers.`
            : `One line per Mode, under its ${levels[level - 1] ?? "group"}.`}{" "}
          {note} Drag a chart to pan it; Ctrl/⌘ + scroll zooms, double-click shows it all.
        </span>
      </div>
      {ambiguity && showAmbiguity && ambiguity.run && (
        <p className="hint-text platform-chart-ambiguity-note">
          <span className="platform-chart-swatch platform-chart-mark-swatch" /> Where Modes of different Emitters overlap,
          from the ambiguity check of{" "}
          {new Date(ambiguity.run.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} (
          {ambiguity.findings.length} pair{ambiguity.findings.length === 1 ? "" : "s"}) — hover a mark for the Modes.{" "}
          <Link to={ambiguity.link}>Open the check</Link>. A Mode no longer pinned isn&apos;t marked.
        </p>
      )}
      <div className={layout === "side" ? "platform-charts-grid side" : "platform-charts-grid"}>
        {PARAMS.map((p) => (
          <ParamChart key={p.key} param={p} rows={rowsFor(p.key)} log={log} orientation={orientation} />
        ))}
      </div>
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

/** A choice kept in localStorage between visits. */
function useRemembered<T extends string>(key: string, initial: T, allowed: T[]): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const v = localStorage.getItem(key) as T | null;
      return v && allowed.includes(v) ? v : initial;
    } catch {
      return initial;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      /* not remembered */
    }
  };
  return [value, set];
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
    children: e.modes.map((m, i) => ({
      key: `${keyPrefix}${e.emitter_id}:${i}`,
      label: m.name,
      title: `${m.name} — ${title}`,
      modes: [m],
      modeRef: m.id ? `${e.emitter_id}:${m.id}` : undefined,
    })),
  };
}

/** What a Platform's pinned Emitter versions cover: per Emitter or per Mode. */
export function PlatformCharts({ platformId }: { platformId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["platform-coverage", platformId],
    queryFn: () => platformCoverageApi.get(platformId),
  });
  const nodes = useMemo(() => (data ?? []).map((e) => emitterNode(e)), [data]);
  const latest = useLatestAmbiguity("platform", platformId);
  if (isLoading) return <p className="hint-text">Loading what the Emitters cover…</p>;
  if (!data?.length) return <p className="hint-text">Pin an Emitter version to see what this Platform covers.</p>;
  return (
    <CoverageCharts
      nodes={nodes}
      levels={["Emitter", "Mode"]}
      storageKey="platformChartLevel"
      note="As of each pinned version."
      ambiguity={{ ...latest, link: `/ambiguity/platform/${platformId}` }}
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
  const latest = useLatestAmbiguity("mdf", mdfId);
  if (isLoading) return <p className="hint-text">Loading what the Platforms cover…</p>;
  if (!data?.length) return <p className="hint-text">Pin a Platform version to see what this MDF covers.</p>;
  return (
    <CoverageCharts
      nodes={nodes}
      levels={["Platform", "Emitter", "Mode"]}
      storageKey="mdfChartLevel"
      ambiguity={{ ...latest, link: `/ambiguity/mdf/${mdfId}` }}
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
