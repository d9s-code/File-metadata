import { useMemo, useState, type MouseEvent, type PointerEvent } from "react";
import type { Mode } from "../../types/domain";
import type { EntryMatch, MatchableEntry } from "../intercepts/interceptMatch";
import { describeMiss } from "../intercepts/interceptMatch";
import { fmt, niceTicks, useWidth } from "../intercepts/charts/Histogram";
import { domainOf, modeRanges, type ChartParam, type ModeRanges, type Span } from "../modes/charts/modeRanges";

export type RecheckNow = "match" | "near" | "none" | "unknown";

/** A logged set as the chart draws it. */
export interface RecheckPoint {
  key: string;
  where: string;
  /** Its parameters in words, for the read-out. */
  text: string;
  entry: MatchableEntry;
  match: EntryMatch | null;
  now: RecheckNow;
  /** Today's match differs from what was reported in the test. */
  changed: boolean;
  /** What the system reported for it during the test. */
  reported: string;
}

const PARAMS: ChartParam[] = ["rf", "pri", "pw"];
const AXES: Record<ChartParam, { short: string; unit: string }> = {
  rf: { short: "RF", unit: "MHz" },
  pri: { short: "PRI / frame time", unit: "µs" },
  pw: { short: "PW", unit: "µs" },
};
const AXES_KEY = "recheckChartAxes";
const VIEW_KEY = "recheckChartView";
const HEIGHT = 340;
const M = { left: 60, right: 14, top: 14, bottom: 40 };
// Within this many pixels of the pointer, points are read out together.
const HOVER_PX = 8;
// One parameter per strip: a row of points, then the Modes' ranges in lanes.
const STRIP = { title: 18, pointRow: 14, lane: 12, laneGap: 3, axis: 22 };

const NOW_LABEL: Record<RecheckNow, string> = {
  match: "Would match",
  near: "Near — one value off",
  none: "No Mode",
  unknown: "Can't compare",
};

/** How the chart is drawn — remembered in this browser. */
interface View {
  /** Two parameters against each other, or each parameter on its own strip. */
  layout: "pair" | "each";
  scale: "linear" | "log";
  /** The Modes' ranges with their delta (what the sensor matches), or as typed. */
  ranges: "engineered" | "typed";
  /** Fit the axes to the Modes and the logged values, or to the logged values only. */
  fit: "all" | "logged";
  names: boolean;
}
const DEFAULT_VIEW: View = { layout: "pair", scale: "linear", ranges: "engineered", fit: "all", names: true };

function readView(): View {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null") as Partial<View> | null;
    return {
      layout: v?.layout === "each" ? "each" : "pair",
      scale: v?.scale === "log" ? "log" : "linear",
      ranges: v?.ranges === "typed" ? "typed" : "engineered",
      fit: v?.fit === "logged" ? "logged" : "all",
      names: v?.names !== false,
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

function readAxes(): { x: ChartParam; y: ChartParam } {
  try {
    const v = JSON.parse(localStorage.getItem(AXES_KEY) ?? "null") as { x?: string; y?: string } | null;
    const x = PARAMS.find((k) => k === v?.x);
    const y = PARAMS.find((k) => k === v?.y);
    if (x && y && x !== y) return { x, y };
  } catch {
    // Unreadable — the default.
  }
  return { x: "rf", y: "pri" };
}

function remember(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered — fine.
  }
}

function value(e: MatchableEntry, p: ChartParam): number | null {
  return p === "rf" ? e.rf_mean_mhz : p === "pri" ? e.pri_mean_us : e.pw_mean_us;
}

function spanFor(r: ModeRanges, p: ChartParam, typed: boolean): Span | null {
  if (p === "rf") return typed ? r.rfRaw : r.rf;
  if (p === "pri") return typed ? r.priRaw : r.pri;
  return typed ? r.pwRaw : r.pw;
}

/** Round-numbered ticks on a log axis: 1, 2 and 5 in each decade — or plain
 * ones when the range is under a decade or so. */
function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let k = Math.floor(Math.log10(lo)); k <= Math.ceil(Math.log10(hi)); k++) {
    for (const m of [1, 2, 5]) {
      const t = m * 10 ** k;
      if (t >= lo && t <= hi) out.push(Number(t.toPrecision(6)));
    }
  }
  if (out.length < 3) return niceTicks(lo, hi);
  // Many decades: just the powers of ten.
  return out.length > 12 ? out.filter((t) => Math.abs(Math.log10(t) - Math.round(Math.log10(t))) < 1e-9) : out;
}

interface Scale {
  domain: Span;
  /** Pixel position of a value (clamped to the axis on a log scale when ≤ 0). */
  at: (v: number) => number;
  ticks: number[];
}

/** An axis from px0 (low values) to px1, linear or logarithmic, over the
 * values and spans given (only positive ones count on a log scale). */
function makeScale(values: number[], spans: Span[], log: boolean, px0: number, px1: number): Scale {
  let domain: Span;
  if (log) {
    const pos = [...values, ...spans.flat()].filter((v) => v > 0);
    let lo = pos.length ? Math.min(...pos) : 1;
    let hi = pos.length ? Math.max(...pos) : 10;
    if (lo === hi) [lo, hi] = [lo / 1.5, hi * 1.5];
    else [lo, hi] = [lo / 1.06, hi * 1.06];
    domain = [lo, hi];
  } else {
    domain = domainOf(spans, values);
  }
  const [lo, hi] = domain;
  const f = log ? (v: number) => Math.log10(Math.max(v, lo)) : (v: number) => v;
  const span = f(hi) - f(lo) || 1;
  return {
    domain,
    at: (v) => px0 + ((f(v) - f(lo)) / span) * (px1 - px0),
    ticks: log ? logTicks(lo, hi) : niceTicks(lo, hi),
  };
}

/** A point's mark: a shape per outcome as well as a colour — never colour alone. */
function Mark({ now, x, y, ring, changed }: { now: RecheckNow; x: number; y: number; ring: boolean; changed: boolean }) {
  const r = ring ? 7 : 5;
  const cls = `recheck-mark recheck-mark-${now}`;
  return (
    <g>
      {(changed || ring) && <circle cx={x} cy={y} r={r + 4} className={ring ? "recheck-mark-ring picked" : "recheck-mark-ring"} />}
      {now === "match" && <circle cx={x} cy={y} r={r} className={cls} />}
      {now === "near" && (
        <path d={`M${x},${y - r * 1.2} L${x + r * 1.1},${y + r * 0.8} L${x - r * 1.1},${y + r * 0.8} Z`} className={cls} />
      )}
      {now === "none" && (
        <path d={`M${x - r},${y - r} L${x + r},${y + r} M${x + r},${y - r} L${x - r},${y + r}`} className={cls} strokeWidth={3} />
      )}
      {now === "unknown" && <rect x={x - r} y={y - r} width={r * 2} height={r * 2} className={cls} />}
    </g>
  );
}

type Tip = { keys: string[]; cx: number; cy: number };

/** The run's logged sets over the Emitter's Modes as they are now, coloured
 * and shaped by whether they'd match now. Two parameters against each other
 * (a near miss dashed to the Mode it's close to), or each parameter on a strip
 * of its own; linear or log; the Modes' ranges with their delta or as typed.
 * Clicking a point picks its row in the table. */
export function RecheckChart({
  points,
  modes,
  picked,
  onPick,
}: {
  points: RecheckPoint[];
  modes: Mode[];
  picked: string | null;
  onPick: (key: string | null) => void;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [axes, setAxesState] = useState(readAxes);
  const [view, setViewState] = useState(readView);
  const [tip, setTip] = useState<Tip | null>(null);
  const [hoverMode, setHoverMode] = useState<string | null>(null);
  function setAxes(x: ChartParam, y: ChartParam) {
    setAxesState({ x, y });
    remember(AXES_KEY, { x, y });
  }
  function setView(change: Partial<View>) {
    const next = { ...view, ...change };
    setViewState(next);
    remember(VIEW_KEY, next);
  }
  const log = view.scale === "log";
  const typed = view.ranges === "typed";

  const ranges = useMemo(() => modes.map(modeRanges).filter((r): r is ModeRanges => !!r), [modes]);
  const byKey = new Map(points.map((p) => [p.key, p]));
  const plotW = Math.max(10, width - M.left - M.right);
  // On a log scale, values at or below 0 can't be drawn.
  const drawable = (v: number | null): v is number => v != null && (!log || v > 0);
  const hidden = points.filter((p) =>
    (view.layout === "pair" ? [axes.x, axes.y] : PARAMS).some((k) => value(p.entry, k) != null && !drawable(value(p.entry, k))),
  ).length;

  function tipAt(e: PointerEvent, keys: string[]) {
    setTip(keys.length ? { keys, cx: e.clientX, cy: e.clientY } : null);
  }

  const select = (label: string, current: string, options: [string, string][], set: (v: string) => void, disabled?: string) => (
    <label className="inline-label">
      {label}
      <select value={current} onChange={(e) => set(e.target.value)}>
        {options.map(([v, text]) => (
          <option key={v} value={v} disabled={v === disabled}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
  const paramOptions = PARAMS.map((p) => [p, AXES[p].short] as [string, string]);

  // ── Two parameters against each other ──
  const pair = (() => {
    if (view.layout !== "pair" || width === 0) return null;
    const boxes = ranges.flatMap((r) => {
      const x = spanFor(r, axes.x, typed);
      const y = spanFor(r, axes.y, typed);
      return x && y ? [{ r, x, y }] : [];
    });
    const placed = points.flatMap((p) => {
      const x = value(p.entry, axes.x);
      const y = value(p.entry, axes.y);
      return drawable(x) && drawable(y) ? [{ p, x, y }] : [];
    });
    const plotH = HEIGHT - M.top - M.bottom;
    const fitAll = view.fit === "all" || placed.length === 0;
    const sx = makeScale(placed.map((d) => d.x), fitAll ? boxes.map((b) => b.x) : [], log, M.left, M.left + plotW);
    const sy = makeScale(placed.map((d) => d.y), fitAll ? boxes.map((b) => b.y) : [], log, M.top + plotH, M.top);
    const clampX = (v: number) => Math.min(M.left + plotW, Math.max(M.left, v));
    const clampY = (v: number) => Math.min(M.top + plotH, Math.max(M.top, v));
    const boxOf = new Map(boxes.map((b) => [b.r.mode.id, b]));
    const keysNear = (px: number, py: number) =>
      placed.filter((d) => Math.hypot(sx.at(d.x) - px, sy.at(d.y) - py) <= HOVER_PX).map((d) => d.p.key);
    const local = (e: MouseEvent<SVGSVGElement>) => {
      const b = e.currentTarget.getBoundingClientRect();
      return [e.clientX - b.left, e.clientY - b.top] as const;
    };
    return {
      count: boxes.length,
      svg: (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Logged values by ${AXES[axes.x].short} and ${AXES[axes.y].short} over the Modes`}
          onPointerMove={(e) => tipAt(e, keysNear(...local(e)))}
          onPointerLeave={() => {
            setTip(null);
            setHoverMode(null);
          }}
          onClick={(e) => onPick(keysNear(...local(e))[0] ?? null)}
        >
          <defs>
            <clipPath id="recheck-plot-clip">
              <rect x={M.left} y={M.top} width={plotW} height={plotH} />
            </clipPath>
          </defs>
          {sx.ticks.map((t) => (
            <g key={`x${t}`}>
              <line x1={sx.at(t)} x2={sx.at(t)} y1={M.top} y2={M.top + plotH} className="viz-grid" />
              <text x={sx.at(t)} y={M.top + plotH + 14} textAnchor="middle" className="viz-axis-label">
                {fmt(t)}
              </text>
            </g>
          ))}
          {sy.ticks.map((t) => (
            <g key={`y${t}`}>
              <line x1={M.left} x2={M.left + plotW} y1={sy.at(t)} y2={sy.at(t)} className="viz-grid" />
              <text x={M.left - 6} y={sy.at(t) + 4} textAnchor="end" className="viz-axis-label">
                {fmt(t)}
              </text>
            </g>
          ))}
          <text x={M.left + plotW / 2} y={HEIGHT - 4} textAnchor="middle" className="viz-axis-label recheck-axis-title">
            {AXES[axes.x].short} ({AXES[axes.x].unit}){log ? " · log" : ""}
          </text>
          <text
            transform={`translate(12 ${M.top + plotH / 2}) rotate(-90)`}
            textAnchor="middle"
            className="viz-axis-label recheck-axis-title"
          >
            {AXES[axes.y].short} ({AXES[axes.y].unit}){log ? " · log" : ""}
          </text>
          <g clipPath="url(#recheck-plot-clip)">
            {boxes.map(({ r, x, y }) => {
              const x0 = sx.at(x[0]);
              const y0 = sy.at(y[1]);
              const w = Math.max(3, sx.at(x[1]) - x0);
              const h = Math.max(3, sy.at(y[0]) - y0);
              return (
                <g key={r.mode.id} onPointerEnter={() => setHoverMode(r.mode.id)} onPointerLeave={() => setHoverMode(null)}>
                  <rect x={x0} y={y0} width={w} height={h} className={hoverMode === r.mode.id ? "recheck-mode-box hot" : "recheck-mode-box"}>
                    <title>
                      {`${r.mode.name}: ${AXES[axes.x].short} ${fmt(x[0])}–${fmt(x[1])} ${AXES[axes.x].unit}, ${AXES[axes.y].short} ${fmt(y[0])}–${fmt(y[1])} ${AXES[axes.y].unit}`}
                    </title>
                  </rect>
                  {view.names && w > 40 && (
                    // Inside the box's top, or just above a box too thin for it.
                    <text x={x0 + 4} y={h > 14 ? y0 + 12 : y0 - 3} className="recheck-mode-label">
                      {r.mode.name}
                    </text>
                  )}
                </g>
              );
            })}
            {/* A near miss: dashed to the nearest edge of the Mode it's close to. */}
            {placed.map(({ p, x, y }) => {
              const target = p.now === "near" ? p.match?.near[0] : undefined;
              const b = target && boxOf.get(target.mode.id);
              if (!b) return null;
              const tx = Math.min(Math.max(x, b.x[0]), b.x[1]);
              const ty = Math.min(Math.max(y, b.y[0]), b.y[1]);
              if (tx === x && ty === y) return null;
              return (
                <line
                  key={`n-${p.key}`}
                  x1={sx.at(x)}
                  y1={sy.at(y)}
                  x2={clampX(sx.at(tx))}
                  y2={clampY(sy.at(ty))}
                  className="recheck-near-line"
                />
              );
            })}
            {placed.map(({ p, x, y }) => (
              <Mark key={p.key} now={p.now} x={sx.at(x)} y={sy.at(y)} ring={picked === p.key} changed={p.changed} />
            ))}
          </g>
        </svg>
      ),
    };
  })();

  // ── Each parameter on a strip of its own ──
  const strips = (() => {
    if (view.layout !== "each" || width === 0) return null;
    return PARAMS.map((param) => {
      const bars = ranges.flatMap((r) => {
        const s = spanFor(r, param, typed);
        return s && (!log || s[1] > 0) ? [{ r, s }] : [];
      });
      const placed = points.flatMap((p) => {
        const v = value(p.entry, param);
        return drawable(v) ? [{ p, v }] : [];
      });
      const fitAll = view.fit === "all" || placed.length === 0;
      const sx = makeScale(placed.map((d) => d.v), fitAll ? bars.map((b) => b.s) : [], log, M.left, M.left + plotW);
      // Points stacked into rows so close ones don't hide each other.
      const rows: number[] = [];
      const dots = [...placed]
        .sort((a, b) => a.v - b.v)
        .map((d) => {
          const px = sx.at(d.v);
          let row = rows.findIndex((end) => px - end >= 12);
          if (row < 0) row = rows.push(-Infinity) - 1;
          rows[row] = px;
          return { ...d, px, row };
        });
      // The Modes' ranges packed into lanes, left to right.
      const lanes: number[] = [];
      const laid = [...bars]
        .sort((a, b) => a.s[0] - b.s[0])
        .map((b) => {
          const x0 = sx.at(b.s[0]);
          const x1 = Math.max(x0 + 3, sx.at(b.s[1]));
          let lane = lanes.findIndex((end) => x0 - end >= 4);
          if (lane < 0) lane = lanes.push(-Infinity) - 1;
          lanes[lane] = x1;
          return { ...b, x0, x1, lane };
        });
      const pointsH = Math.max(1, rows.length) * STRIP.pointRow + 6;
      const lanesH = Math.max(1, lanes.length) * (STRIP.lane + STRIP.laneGap);
      const top = STRIP.title + pointsH;
      const height = top + lanesH + STRIP.axis;
      return (
        <svg
          key={param}
          width={width}
          height={height}
          className="recheck-strip"
          role="img"
          aria-label={`Logged ${AXES[param].short} over the Modes' ranges`}
          onPointerLeave={() => {
            setTip(null);
            setHoverMode(null);
          }}
        >
          <defs>
            <clipPath id={`recheck-strip-clip-${param}`}>
              <rect x={M.left} y={0} width={plotW} height={height} />
            </clipPath>
          </defs>
          <text x={0} y={12} className="viz-axis-label recheck-axis-title">
            {AXES[param].short} ({AXES[param].unit}){log ? " · log" : ""}
          </text>
          <text x={M.left - 6} y={STRIP.title + pointsH / 2 + 3} textAnchor="end" className="viz-axis-label">
            Logged
          </text>
          <text x={M.left - 6} y={top + STRIP.lane - 2} textAnchor="end" className="viz-axis-label">
            Modes
          </text>
          {sx.ticks.map((t) => (
            <g key={t}>
              <line x1={sx.at(t)} x2={sx.at(t)} y1={STRIP.title} y2={height - STRIP.axis} className="viz-grid" />
              <text x={sx.at(t)} y={height - 8} textAnchor="middle" className="viz-axis-label">
                {fmt(t)}
              </text>
            </g>
          ))}
          <g clipPath={`url(#recheck-strip-clip-${param})`}>
            {laid.map(({ r, s, x0, x1, lane }) => {
              const y = top + lane * (STRIP.lane + STRIP.laneGap);
              const label = view.names && x1 - x0 > r.mode.name.length * 6 + 8;
              return (
                <g key={r.mode.id} onPointerEnter={() => setHoverMode(r.mode.id)} onPointerLeave={() => setHoverMode(null)}>
                  <rect
                    x={x0}
                    y={y}
                    width={x1 - x0}
                    height={STRIP.lane}
                    rx={2}
                    className={hoverMode === r.mode.id ? "recheck-mode-box hot" : "recheck-mode-box"}
                  >
                    <title>{`${r.mode.name}: ${fmt(s[0])}–${fmt(s[1])} ${AXES[param].unit}`}</title>
                  </rect>
                  {label && (
                    <text x={x0 + 4} y={y + STRIP.lane - 3} className="recheck-mode-label">
                      {r.mode.name}
                    </text>
                  )}
                </g>
              );
            })}
            {dots.map(({ p, px, row }) => {
              const nearMode = p.now === "near" ? p.match?.near[0]?.mode.id : undefined;
              return (
                <g
                  key={p.key}
                  className="recheck-strip-dot"
                  onPointerEnter={(e) => {
                    tipAt(e, [p.key]);
                    if (nearMode) setHoverMode(nearMode);
                  }}
                  onPointerLeave={() => {
                    setTip(null);
                    setHoverMode(null);
                  }}
                  onClick={() => onPick(p.key === picked ? null : p.key)}
                >
                  <Mark
                    now={p.now}
                    x={px}
                    y={STRIP.title + 3 + row * STRIP.pointRow + STRIP.pointRow / 2}
                    ring={picked === p.key || tip?.keys[0] === p.key}
                    changed={p.changed}
                  />
                </g>
              );
            })}
          </g>
        </svg>
      );
    });
  })();

  const shownModes =
    view.layout === "pair" ? (pair?.count ?? 0) : ranges.filter((r) => PARAMS.some((p) => spanFor(r, p, typed))).length;
  const tipPoints = (tip?.keys ?? []).map((k) => byKey.get(k)).filter((p): p is RecheckPoint => !!p);

  return (
    <div className="recheck-chart">
      <div className="chart-controls-row recheck-chart-controls">
        {select("View", view.layout, [["pair", "Two parameters"], ["each", "Each parameter"]], (v) => setView({ layout: v as View["layout"] }))}
        {view.layout === "pair" && (
          <>
            {select("Across", axes.x, paramOptions, (v) => setAxes(v as ChartParam, axes.y), axes.y)}
            {select("Up", axes.y, paramOptions, (v) => setAxes(axes.x, v as ChartParam), axes.x)}
            <button type="button" className="link-button" onClick={() => setAxes(axes.y, axes.x)} title="Swap the axes">
              ⇄ Swap
            </button>
          </>
        )}
        {select("Scale", view.scale, [["linear", "Linear"], ["log", "Logarithmic"]], (v) => setView({ scale: v as View["scale"] }))}
        {select(
          "Mode ranges",
          view.ranges,
          [["engineered", "With the delta"], ["typed", "As typed"]],
          (v) => setView({ ranges: v as View["ranges"] }),
        )}
        {select(
          "Fit",
          view.fit,
          [["all", "Modes and logged values"], ["logged", "Logged values only"]],
          (v) => setView({ fit: v as View["fit"] }),
        )}
        <label className="inline-label">
          <input type="checkbox" checked={view.names} onChange={(e) => setView({ names: e.target.checked })} />
          Mode names
        </label>
        {(view.layout !== DEFAULT_VIEW.layout ||
          view.scale !== DEFAULT_VIEW.scale ||
          view.ranges !== DEFAULT_VIEW.ranges ||
          view.fit !== DEFAULT_VIEW.fit ||
          !view.names) && (
          <button type="button" className="link-button" onClick={() => setView(DEFAULT_VIEW)}>
            Reset view
          </button>
        )}
      </div>
      <p className="hint-text recheck-chart-counts">
        {shownModes} Mode{shownModes === 1 ? "" : "s"} drawn
        {view.layout === "pair" &&
          ranges.length > shownModes &&
          ` (${ranges.length - shownModes} without ${AXES[axes.x].short} and ${AXES[axes.y].short})`}
        {hidden > 0 && ` · ${hidden} set${hidden === 1 ? "" : "s"} with a value at or below 0 left off the log scale`}
      </p>
      <div ref={ref} className="recheck-chart-plot">
        {pair?.svg}
        {strips}
      </div>
      {tipPoints.length > 0 && tip && (
        <div
          className="recheck-chart-tip"
          style={{
            left: Math.max(8, Math.min(tip.cx + 14, window.innerWidth - 320)),
            top: tip.cy + 170 > window.innerHeight ? tip.cy - 160 : tip.cy + 14,
          }}
        >
          {tipPoints.slice(0, 4).map((p) => (
            <div key={p.key}>
              <strong>{p.where}</strong>
              <div className="hint-text">{p.text}</div>
              <div>
                {NOW_LABEL[p.now]}
                {p.match?.matches.length ? `: ${p.match.matches.map((m) => m.name).join(", ")}` : ""}
                {p.now === "near" && p.match?.near[0] && (
                  <>
                    {" "}
                    — {p.match.near[0].mode.name}: {p.match.near[0].misses.map(describeMiss).join("; ")}
                  </>
                )}
                {p.changed && <div className="hint-text">Changed since test — reported then: {p.reported}</div>}
              </div>
            </div>
          ))}
          {tipPoints.length > 4 && <div className="hint-text">and {tipPoints.length - 4} more here</div>}
          <div className="hint-text">Click to pick it out in the table</div>
        </div>
      )}
      <div className="viz-legend recheck-chart-legend">
        <span>
          <svg width="16" height="14" aria-hidden>
            <circle cx="8" cy="7" r="5" className="recheck-mark recheck-mark-match" />
          </svg>{" "}
          Would match
        </span>
        <span>
          <svg width="16" height="14" aria-hidden>
            <path d="M8,1 L13.5,11 L2.5,11 Z" className="recheck-mark recheck-mark-near" />
          </svg>{" "}
          {view.layout === "pair" ? "Near (dashed to the Mode)" : "Near (hover: its Mode lights up)"}
        </span>
        <span>
          <svg width="16" height="14" aria-hidden>
            <path d="M3,2 L13,12 M13,2 L3,12" className="recheck-mark recheck-mark-none" strokeWidth={3} />
          </svg>{" "}
          No Mode
        </span>
        <span>
          <svg width="20" height="18" aria-hidden>
            <circle cx="10" cy="9" r="8" className="recheck-mark-ring" />
          </svg>{" "}
          Changed since test
        </span>
        <span>
          <span className="viz-swatch recheck-mode-swatch" /> A Mode now ({typed ? "its range as typed" : "its range with the delta"})
        </span>
      </div>
      <p className="hint-text recheck-chart-note">
        {view.layout === "pair"
          ? "A point inside a Mode's box can still miss it on the parameter not drawn, its jitter or a stagger's steps — hover for why, or view each parameter."
          : "Each parameter on its own: a point outside every Mode's range on a strip is what it misses on. Jitter and a stagger's steps aren't drawn — hover for why."}
        {typed && " Matching uses the ranges with their delta."}
      </p>
    </div>
  );
}
