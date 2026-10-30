import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
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
const HEIGHT = 380;
const TALL_HEIGHT = 640;
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
  /** The two-parameter plot's height: taller spreads crowded Modes out. */
  size: "normal" | "tall";
}
const DEFAULT_VIEW: View = { layout: "pair", scale: "linear", ranges: "engineered", fit: "all", names: true, size: "normal" };

function readView(): View {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null") as Partial<View> | null;
    return {
      layout: v?.layout === "each" ? "each" : "pair",
      scale: v?.scale === "log" ? "log" : "linear",
      ranges: v?.ranges === "typed" ? "typed" : "engineered",
      fit: v?.fit === "logged" ? "logged" : "all",
      names: v?.names !== false,
      size: v?.size === "tall" ? "tall" : "normal",
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
function logTicks(lo: number, hi: number, count: number): number[] {
  const out: number[] = [];
  for (let k = Math.floor(Math.log10(lo)); k <= Math.ceil(Math.log10(hi)); k++) {
    for (const m of [1, 2, 5]) {
      const t = m * 10 ** k;
      if (t >= lo && t <= hi) out.push(Number(t.toPrecision(6)));
    }
  }
  if (out.length < 3) return niceTicks(lo, hi, count);
  // Many decades: just the powers of ten.
  return out.length > 12 ? out.filter((t) => Math.abs(Math.log10(t) - Math.round(Math.log10(t))) < 1e-9) : out;
}

/** Values to positions along an axis, and back. */
interface Scale {
  domain: Span;
  /** Pixel position of a value (clamped to the axis on a log scale when ≤ 0). */
  at: (v: number) => number;
  /** The value at a pixel position. */
  valueAt: (px: number) => number;
  ticks: number[];
}

const fwd = (log: boolean) => (v: number) => (log ? Math.log10(v) : v);
const back = (log: boolean) => (t: number) => (log ? 10 ** t : t);

/** The axis's range, fitted to the values and spans given (only positive ones
 * count on a log scale). */
function fitDomain(values: number[], spans: Span[], log: boolean): Span {
  if (!log) return domainOf(spans, values);
  const pos = [...values, ...spans.flat()].filter((v) => v > 0);
  const lo = pos.length ? Math.min(...pos) : 1;
  const hi = pos.length ? Math.max(...pos) : 10;
  return lo === hi ? [lo / 1.5, hi * 1.5] : [lo / 1.06, hi * 1.06];
}

/** An axis over a range, from px0 (low values) to px1, linear or log, with
 * about one tick per `tickPx` pixels. */
function makeScale(domain: Span, log: boolean, px0: number, px1: number, tickPx: number): Scale {
  const [lo, hi] = domain;
  const f = log ? (v: number) => Math.log10(Math.max(v, lo)) : (v: number) => v;
  const g = back(log);
  const span = f(hi) - f(lo) || 1;
  const count = Math.max(3, Math.round(Math.abs(px1 - px0) / tickPx));
  return {
    domain,
    at: (v) => px0 + ((f(v) - f(lo)) / span) * (px1 - px0),
    valueAt: (px) => g(f(lo) + ((px - px0) / (px1 - px0)) * span),
    ticks: log ? logTicks(lo, hi, count) : niceTicks(lo, hi, count),
  };
}

/** A range moved by a share of its width (on the axis as drawn). */
function panSpan(d: Span, share: number, log: boolean): Span {
  const f = fwd(log);
  const g = back(log);
  const shift = (f(d[1]) - f(d[0])) * share;
  return [g(f(d[0]) + shift), g(f(d[1]) + shift)];
}

/** A range shrunk (k < 1) or grown (k > 1) around a point `at` (0–1 along it). */
function zoomSpan(d: Span, k: number, at: number, log: boolean): Span {
  const f = fwd(log);
  const g = back(log);
  const a = f(d[0]);
  const b = f(d[1]);
  const c = a + (b - a) * at;
  // Never narrower than a millionth of the values — beyond that it's all rounding.
  const min = Math.max(Math.abs(c) * 1e-6, 1e-9);
  if (k < 1 && (b - a) * k < min) return d;
  return [g(c - (c - a) * k), g(c + (b - c) * k)];
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

type Tip = { keys: string[]; modes: string[]; cx: number; cy: number };
/** The zoomed ranges, by axis ("x", "y", or a strip's parameter) — for one
 * arrangement of the chart only: changing the view starts from the fit again. */
type Zoom = { sig: string; spans: Record<string, Span> };
/** A drag in progress: panning, or (with Shift) drawing a box to zoom to. */
type Drag = {
  target: string;
  kind: "pan" | "box";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  moved: boolean;
  start: Record<string, Span>;
};
/** Where things are drawn, for the wheel handler (it runs outside React's render). */
type Geometry = { left: number; top: number; w: number; h: number; x: Scale; y?: Scale; xKey: string; yKey?: string };

const ZOOM_STEP = 1.6;
// A drag shorter than this is a click.
const DRAG_PX = 4;

/** The run's logged sets over the Emitter's Modes as they are now, coloured
 * and shaped by whether they'd match now. Two parameters against each other
 * (a near miss dashed to the Mode it's close to), or each parameter on a strip
 * of its own; linear or log; the Modes' ranges with their delta or as typed.
 * Drag to pan, Ctrl/⌘ + scroll (or pinch) to zoom, Shift + drag to zoom to a
 * box; hovering lists the Modes under the pointer. Clicking a point picks its
 * row in the table. */
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
  const { ref: widthRef, width } = useWidth<HTMLDivElement>();
  const plotRef = useRef<HTMLDivElement | null>(null);
  const [axes, setAxesState] = useState(readAxes);
  const [view, setViewState] = useState(readView);
  const [tip, setTip] = useState<Tip | null>(null);
  const [hot, setHot] = useState<string[]>([]);
  const [zoomState, setZoomState] = useState<Zoom>({ sig: "", spans: {} });
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [wheelHint, setWheelHint] = useState(false);
  const hintTimer = useRef<number | undefined>(undefined);
  const geometry = useRef<Record<string, Geometry>>({});

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
  const height = view.size === "tall" ? TALL_HEIGHT : HEIGHT;
  // The zoom belongs to this arrangement only.
  const sig = [view.layout, axes.x, axes.y, view.scale, view.ranges, view.fit].join("|");
  const zoom = zoomState.sig === sig ? zoomState.spans : {};
  const zoomed = Object.keys(zoom).length > 0;
  function setZoom(spans: Record<string, Span>) {
    setZoomState({ sig, spans: { ...zoom, ...spans } });
  }
  function setDrag(d: Drag | null) {
    dragRef.current = d;
    setDragState(d);
  }

  const ranges = useMemo(() => modes.map(modeRanges).filter((r): r is ModeRanges => !!r), [modes]);
  const byKey = new Map(points.map((p) => [p.key, p]));
  const byMode = new Map(ranges.map((r) => [r.mode.id, r]));
  const plotW = Math.max(10, width - M.left - M.right);
  // On a log scale, values at or below 0 can't be drawn.
  const drawable = (v: number | null): v is number => v != null && (!log || v > 0);
  const hidden = points.filter((p) =>
    (view.layout === "pair" ? [axes.x, axes.y] : PARAMS).some((k) => value(p.entry, k) != null && !drawable(value(p.entry, k))),
  ).length;

  // Zooms every axis shown, around the middle — for the buttons.
  function zoomAll(k: number) {
    const next: Record<string, Span> = {};
    for (const g of Object.values(geometry.current)) {
      next[g.xKey] = zoomSpan(g.x.domain, k, 0.5, log);
      if (g.y && g.yKey) next[g.yKey] = zoomSpan(g.y.domain, k, 0.5, log);
    }
    setZoom(next);
  }

  // Ctrl/⌘ + wheel (and a trackpad pinch, which arrives as one) zooms around
  // the pointer — over an axis, that axis only. A plain wheel scrolls the page.
  const onWheel = useRef<(e: WheelEvent) => void>(() => {});
  onWheel.current = (e: WheelEvent) => {
    const svg = (e.target as Element | null)?.closest?.("svg[data-chart]");
    const g = svg ? geometry.current[svg.getAttribute("data-chart") ?? ""] : undefined;
    if (!svg || !g) return;
    if (!e.ctrlKey && !e.metaKey) {
      setWheelHint(true);
      window.clearTimeout(hintTimer.current);
      hintTimer.current = window.setTimeout(() => setWheelHint(false), 1400);
      return;
    }
    e.preventDefault();
    const box = svg.getBoundingClientRect();
    const px = e.clientX - box.left;
    const py = e.clientY - box.top;
    const k = Math.min(4, Math.max(0.25, Math.exp(e.deltaY * 0.004)));
    const overYAxis = px < g.left;
    const overXAxis = py > g.top + g.h;
    const next: Record<string, Span> = {};
    if (!overYAxis) next[g.xKey] = zoomSpan(g.x.domain, k, Math.min(1, Math.max(0, (px - g.left) / g.w)), log);
    if (g.y && g.yKey && !overXAxis) next[g.yKey] = zoomSpan(g.y.domain, k, Math.min(1, Math.max(0, (g.top + g.h - py) / g.h)), log);
    setZoom(next);
  };
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => onWheel.current(e);
    el.addEventListener("wheel", handler, { passive: false });
    return () => {
      el.removeEventListener("wheel", handler);
      window.clearTimeout(hintTimer.current);
    };
  }, []);

  /** Pointer handlers for one chart (the pair plot, or a strip): drag to pan,
   * Shift + drag to zoom to a box, a click passed on, double-click to zoom in. */
  function gestures(target: string, onClickAt: (px: number, py: number) => void, onHover: (e: PointerEvent<SVGSVGElement>, px: number, py: number) => void) {
    const local = (e: { clientX: number; clientY: number; currentTarget: Element }) => {
      const b = e.currentTarget.getBoundingClientRect();
      return [e.clientX - b.left, e.clientY - b.top] as const;
    };
    return {
      onPointerDown: (e: PointerEvent<SVGSVGElement>) => {
        if (e.button !== 0) return;
        const g = geometry.current[target];
        if (!g) return;
        const [px, py] = local(e);
        const start: Record<string, Span> = { [g.xKey]: g.x.domain };
        if (g.y && g.yKey) start[g.yKey] = g.y.domain;
        setDrag({ target, kind: e.shiftKey ? "box" : "pan", x0: px, y0: py, x1: px, y1: py, moved: false, start });
      },
      onPointerMove: (e: PointerEvent<SVGSVGElement>) => {
        const d = dragRef.current;
        const [px, py] = local(e);
        if (!d || d.target !== target) {
          onHover(e, px, py);
          return;
        }
        const moved = d.moved || Math.hypot(px - d.x0, py - d.y0) > DRAG_PX;
        if (moved && !d.moved) e.currentTarget.setPointerCapture(e.pointerId);
        setDrag({ ...d, x1: px, y1: py, moved });
        if (!moved) return;
        setTip(null);
        if (d.kind === "pan") {
          const g = geometry.current[target];
          const next: Record<string, Span> = { [g.xKey]: panSpan(d.start[g.xKey], -(px - d.x0) / g.w, log) };
          if (g.y && g.yKey) next[g.yKey] = panSpan(d.start[g.yKey], (py - d.y0) / g.h, log);
          setZoom(next);
        }
      },
      onPointerUp: (e: PointerEvent<SVGSVGElement>) => {
        const d = dragRef.current;
        setDrag(null);
        if (!d || d.target !== target) return;
        if (!d.moved) {
          onClickAt(d.x0, d.y0);
          return;
        }
        if (d.kind === "box") {
          const g = geometry.current[target];
          const [px, py] = local(e);
          const xs = [d.x0, px].sort((a, b) => a - b);
          const ys = [d.y0, py].sort((a, b) => a - b);
          const next: Record<string, Span> = {};
          if (xs[1] - xs[0] > DRAG_PX) next[g.xKey] = [g.x.valueAt(xs[0]), g.x.valueAt(xs[1])];
          if (g.y && g.yKey && ys[1] - ys[0] > DRAG_PX) next[g.yKey] = [g.y.valueAt(ys[1]), g.y.valueAt(ys[0])];
          setZoom(next);
        }
      },
      onPointerCancel: () => setDrag(null),
      onDoubleClick: (e: MouseEvent<SVGSVGElement>) => {
        const g = geometry.current[target];
        if (!g) return;
        const [px, py] = local(e);
        const next: Record<string, Span> = { [g.xKey]: zoomSpan(g.x.domain, 1 / ZOOM_STEP, (px - g.left) / g.w, log) };
        if (g.y && g.yKey) next[g.yKey] = zoomSpan(g.y.domain, 1 / ZOOM_STEP, (g.top + g.h - py) / g.h, log);
        setZoom(next);
      },
      onPointerLeave: () => {
        if (!dragRef.current) {
          setTip(null);
          setHot([]);
        }
      },
    };
  }

  /** Labels that don't overlap: each tries its spot, then lower down its box
   * (to `maxY`), and is left out if there's no room. The hovered go first. */
  function placeLabels(items: { id: string; name: string; x: number; y: number; maxY: number }[]) {
    const taken: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const order = [...items].sort((a, b) => Number(hot.includes(b.id)) - Number(hot.includes(a.id)));
    const out: { id: string; name: string; x: number; y: number }[] = [];
    for (const it of order) {
      for (let y = it.y; y <= Math.max(it.y, it.maxY); y += 12) {
        const r = { x0: it.x - 1, x1: it.x + it.name.length * 6 + 3, y0: y - 10, y1: y + 2 };
        if (taken.some((t) => r.x0 < t.x1 && r.x1 > t.x0 && r.y0 < t.y1 && r.y1 > t.y0)) continue;
        taken.push(r);
        out.push({ id: it.id, name: it.name, x: it.x, y });
        break;
      }
    }
    return out;
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
  const nextGeometry: Record<string, Geometry> = {};

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
    const plotH = height - M.top - M.bottom;
    const fitAll = view.fit === "all" || placed.length === 0;
    const xFit = fitDomain(placed.map((d) => d.x), fitAll ? boxes.map((b) => b.x) : [], log);
    const yFit = fitDomain(placed.map((d) => d.y), fitAll ? boxes.map((b) => b.y) : [], log);
    const sx = makeScale(zoom.x ?? xFit, log, M.left, M.left + plotW, 90);
    const sy = makeScale(zoom.y ?? yFit, log, M.top + plotH, M.top, 45);
    nextGeometry.pair = { left: M.left, top: M.top, w: plotW, h: plotH, x: sx, y: sy, xKey: "x", yKey: "y" };
    const clampX = (v: number) => Math.min(M.left + plotW, Math.max(M.left, v));
    const clampY = (v: number) => Math.min(M.top + plotH, Math.max(M.top, v));
    const boxOf = new Map(boxes.map((b) => [b.r.mode.id, b]));
    const keysNear = (px: number, py: number) =>
      placed.filter((d) => Math.hypot(sx.at(d.x) - px, sy.at(d.y) - py) <= HOVER_PX).map((d) => d.p.key);
    // The Modes whose box holds a spot, smallest first (the most specific).
    const modesAt = (px: number, py: number) => {
      if (px < M.left || px > M.left + plotW || py < M.top || py > M.top + plotH) return [];
      const x = sx.valueAt(px);
      const y = sy.valueAt(py);
      return boxes
        .filter((b) => x >= b.x[0] && x <= b.x[1] && y >= b.y[0] && y <= b.y[1])
        .sort((a, b) => (a.x[1] - a.x[0]) * (a.y[1] - a.y[0]) - (b.x[1] - b.x[0]) * (b.y[1] - b.y[0]))
        .map((b) => b.r.mode.id);
    };
    const rects = boxes.map(({ r, x, y }) => {
      const x0 = sx.at(x[0]);
      const y0 = sy.at(y[1]);
      return { r, x0, y0, w: Math.max(3, sx.at(x[1]) - x0), h: Math.max(3, sy.at(y[0]) - y0) };
    });
    // Names in the top-left corner of the part of a box in view (or just above
    // a thin one), where they fit and don't collide — zoomed in, a name stays put.
    const labels = view.names
      ? placeLabels(
          rects
            .filter((b) => b.w > 30 && b.x0 + 4 < M.left + plotW && b.x0 + b.w > M.left && b.y0 < M.top + plotH && b.y0 + b.h > M.top)
            .map((b) => {
              const top = Math.max(b.y0, M.top);
              const shown = Math.min(b.y0 + b.h, M.top + plotH) - top;
              const bottom = Math.min(b.y0 + b.h, M.top + plotH);
              return shown > 14
                ? { id: b.r.mode.id, name: b.r.mode.name, x: Math.max(b.x0, M.left) + 4, y: top + 12, maxY: bottom - 2 }
                : { id: b.r.mode.id, name: b.r.mode.name, x: Math.max(b.x0, M.left) + 4, y: b.y0 - 3, maxY: b.y0 - 3 };
            }),
        )
      : [];
    const d = drag && drag.target === "pair" && drag.kind === "box" && drag.moved ? drag : null;
    return {
      count: boxes.length,
      svg: (
        <svg
          width={width}
          height={height}
          data-chart="pair"
          className={drag?.target === "pair" && drag.moved && drag.kind === "pan" ? "recheck-plot panning" : "recheck-plot"}
          role="img"
          aria-label={`Logged values by ${AXES[axes.x].short} and ${AXES[axes.y].short} over the Modes`}
          {...gestures(
            "pair",
            (px, py) => onPick(keysNear(px, py)[0] ?? null),
            (e, px, py) => {
              const keys = keysNear(px, py);
              const here = keys.length ? [] : modesAt(px, py);
              setHot(keys.length ? [] : here);
              setTip(keys.length || here.length ? { keys, modes: here, cx: e.clientX, cy: e.clientY } : null);
            },
          )}
        >
          <defs>
            <clipPath id="recheck-plot-clip">
              <rect x={M.left} y={M.top} width={plotW} height={plotH} />
            </clipPath>
          </defs>
          <rect x={M.left} y={M.top} width={plotW} height={plotH} className="recheck-plot-area" />
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
          <rect x={M.left} y={M.top} width={plotW} height={plotH} className="recheck-plot-frame" />
          <text x={M.left + plotW / 2} y={height - 4} textAnchor="middle" className="viz-axis-label recheck-axis-title">
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
            {rects.map(({ r, x0, y0, w, h }) => (
              <rect
                key={r.mode.id}
                x={x0}
                y={y0}
                width={w}
                height={h}
                className={hot.includes(r.mode.id) ? "recheck-mode-box hot" : "recheck-mode-box"}
              />
            ))}
            {labels.map((l) => (
              <text key={l.id} x={l.x} y={l.y} className={hot.includes(l.id) ? "recheck-mode-label hot" : "recheck-mode-label"}>
                {l.name}
              </text>
            ))}
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
          {d && (
            <rect
              x={Math.min(d.x0, d.x1)}
              y={Math.min(d.y0, d.y1)}
              width={Math.abs(d.x1 - d.x0)}
              height={Math.abs(d.y1 - d.y0)}
              className="recheck-zoom-box"
            />
          )}
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
      const fit = fitDomain(placed.map((d) => d.v), fitAll ? bars.map((b) => b.s) : [], log);
      const sx = makeScale(zoom[param] ?? fit, log, M.left, M.left + plotW, 90);
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
      const stripH = top + lanesH + STRIP.axis;
      const key = `strip-${param}`;
      nextGeometry[key] = { left: M.left, top: STRIP.title, w: plotW, h: stripH - STRIP.axis - STRIP.title, x: sx, xKey: param };
      const laneOf = (py: number) => Math.floor((py - top) / (STRIP.lane + STRIP.laneGap));
      const d = drag && drag.target === key && drag.kind === "box" && drag.moved ? drag : null;
      return (
        <svg
          key={param}
          width={width}
          height={stripH}
          data-chart={key}
          className={drag?.target === key && drag.moved && drag.kind === "pan" ? "recheck-strip recheck-plot panning" : "recheck-strip recheck-plot"}
          role="img"
          aria-label={`Logged ${AXES[param].short} over the Modes' ranges`}
          {...gestures(
            key,
            (px, py) => {
              // A click on a point picks it.
              const dot = dots.find((d) => Math.hypot(d.px - px, STRIP.title + 3 + d.row * STRIP.pointRow + STRIP.pointRow / 2 - py) <= HOVER_PX);
              if (dot) onPick(dot.p.key === picked ? null : dot.p.key);
            },
            (e, px, py) => {
              const dot = dots.find((d) => Math.hypot(d.px - px, STRIP.title + 3 + d.row * STRIP.pointRow + STRIP.pointRow / 2 - py) <= HOVER_PX);
              if (dot) {
                const nearMode = dot.p.now === "near" ? dot.p.match?.near[0]?.mode.id : undefined;
                setHot(nearMode ? [nearMode] : []);
                setTip({ keys: [dot.p.key], modes: [], cx: e.clientX, cy: e.clientY });
                return;
              }
              // The Modes reaching the pointer's value — on its lane, or all of them over the points row.
              const v = sx.valueAt(px);
              const lane = laneOf(py);
              const here = laid
                .filter((b) => v >= b.s[0] && v <= b.s[1] && (py < top || b.lane === lane))
                .map((b) => b.r.mode.id);
              setHot(here);
              setTip(here.length && px >= M.left ? { keys: [], modes: here, cx: e.clientX, cy: e.clientY } : null);
            },
          )}
        >
          <defs>
            <clipPath id={`recheck-strip-clip-${param}`}>
              <rect x={M.left} y={0} width={plotW} height={stripH} />
            </clipPath>
          </defs>
          <rect x={M.left} y={STRIP.title} width={plotW} height={stripH - STRIP.axis - STRIP.title} className="recheck-plot-area" />
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
              <line x1={sx.at(t)} x2={sx.at(t)} y1={STRIP.title} y2={stripH - STRIP.axis} className="viz-grid" />
              <text x={sx.at(t)} y={stripH - 8} textAnchor="middle" className="viz-axis-label">
                {fmt(t)}
              </text>
            </g>
          ))}
          <line x1={M.left} x2={M.left + plotW} y1={top - 3} y2={top - 3} className="viz-grid" />
          <rect x={M.left} y={STRIP.title} width={plotW} height={stripH - STRIP.axis - STRIP.title} className="recheck-plot-frame" />
          <g clipPath={`url(#recheck-strip-clip-${param})`}>
            {laid.map(({ r, x0, x1, lane }) => {
              const y = top + lane * (STRIP.lane + STRIP.laneGap);
              const visible0 = Math.max(x0, M.left);
              const label = view.names && x1 - visible0 > r.mode.name.length * 6 + 8;
              return (
                <g key={r.mode.id}>
                  <rect
                    x={x0}
                    y={y}
                    width={x1 - x0}
                    height={STRIP.lane}
                    rx={2}
                    className={hot.includes(r.mode.id) ? "recheck-mode-box hot" : "recheck-mode-box"}
                  />
                  {label && (
                    <text x={visible0 + 4} y={y + STRIP.lane - 3} className={hot.includes(r.mode.id) ? "recheck-mode-label hot" : "recheck-mode-label"}>
                      {r.mode.name}
                    </text>
                  )}
                </g>
              );
            })}
            {dots.map(({ p, px, row }) => (
              <Mark
                key={p.key}
                now={p.now}
                x={px}
                y={STRIP.title + 3 + row * STRIP.pointRow + STRIP.pointRow / 2}
                ring={picked === p.key || tip?.keys[0] === p.key}
                changed={p.changed}
              />
            ))}
          </g>
          {d && (
            <rect
              x={Math.min(d.x0, d.x1)}
              y={STRIP.title}
              width={Math.abs(d.x1 - d.x0)}
              height={stripH - STRIP.axis - STRIP.title}
              className="recheck-zoom-box"
            />
          )}
        </svg>
      );
    });
  })();
  geometry.current = nextGeometry;

  const shownModes =
    view.layout === "pair" ? (pair?.count ?? 0) : ranges.filter((r) => PARAMS.some((p) => spanFor(r, p, typed))).length;
  const tipPoints = (tip?.keys ?? []).map((k) => byKey.get(k)).filter((p): p is RecheckPoint => !!p);
  const tipModes = (tip?.modes ?? []).map((id) => byMode.get(id)).filter((r): r is ModeRanges => !!r);
  const rangeText = (r: ModeRanges, p: ChartParam) => {
    const s = spanFor(r, p, typed);
    return s ? `${AXES[p].short.split(" ")[0]} ${fmt(s[0])}–${fmt(s[1])}` : null;
  };

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
        {view.layout === "pair" &&
          select("Height", view.size, [["normal", "Normal"], ["tall", "Tall"]], (v) => setView({ size: v as View["size"] }))}
        <label className="inline-label">
          <input type="checkbox" checked={view.names} onChange={(e) => setView({ names: e.target.checked })} />
          Mode names
        </label>
        {(view.layout !== DEFAULT_VIEW.layout ||
          view.scale !== DEFAULT_VIEW.scale ||
          view.ranges !== DEFAULT_VIEW.ranges ||
          view.fit !== DEFAULT_VIEW.fit ||
          view.size !== DEFAULT_VIEW.size ||
          !view.names) && (
          <button type="button" className="link-button" onClick={() => setView(DEFAULT_VIEW)}>
            Reset view
          </button>
        )}
      </div>
      <div className="recheck-zoom-bar">
        <span className="recheck-zoom-buttons" role="group" aria-label="Zoom">
          <button type="button" className="icon-button" onClick={() => zoomAll(1 / ZOOM_STEP)} title="Zoom in">
            +
          </button>
          <button type="button" className="icon-button" onClick={() => zoomAll(ZOOM_STEP)} title="Zoom out">
            −
          </button>
          <button type="button" className="icon-button" disabled={!zoomed} onClick={() => setZoomState({ sig, spans: {} })} title="Back to the whole chart">
            ⤢ Reset zoom
          </button>
        </span>
        <span className="hint-text">
          Drag to pan · Ctrl/⌘ + scroll or pinch to zoom (over an axis: that axis only) · Shift + drag to zoom to a box ·
          double-click to zoom in
        </span>
      </div>
      <p className="hint-text recheck-chart-counts">
        {shownModes} Mode{shownModes === 1 ? "" : "s"} drawn
        {view.layout === "pair" &&
          ranges.length > shownModes &&
          ` (${ranges.length - shownModes} without ${AXES[axes.x].short} and ${AXES[axes.y].short})`}
        {hidden > 0 && ` · ${hidden} set${hidden === 1 ? "" : "s"} with a value at or below 0 left off the log scale`}
        {zoomed && " · zoomed in"}
      </p>
      <div
        ref={(el) => {
          widthRef(el);
          plotRef.current = el;
        }}
        className="recheck-chart-plot viz-plot"
      >
        {pair?.svg}
        {strips}
        {wheelHint && <div className="recheck-wheel-hint">Hold Ctrl (⌘ on a Mac) and scroll to zoom</div>}
      </div>
      {(tipPoints.length > 0 || tipModes.length > 0) && tip && !drag?.moved && (
        <div
          className="recheck-chart-tip"
          style={{
            left: Math.max(8, Math.min(tip.cx + 14, window.innerWidth - 340)),
            top: tip.cy + 200 > window.innerHeight ? Math.max(8, tip.cy - 190) : tip.cy + 14,
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
          {tipPoints.length > 0 && <div className="hint-text">Click to pick it out in the table</div>}
          {tipModes.length > 0 && (
            <div>
              <strong>
                {tipModes.length} Mode{tipModes.length === 1 ? "" : "s"} here
              </strong>
              {tipModes.slice(0, 8).map((r) => (
                <div key={r.mode.id} className="recheck-tip-mode">
                  {r.mode.name}{" "}
                  <span className="hint-text">
                    {(view.layout === "pair" ? [axes.x, axes.y] : PARAMS)
                      .map((p) => rangeText(r, p))
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
              ))}
              {tipModes.length > 8 && <div className="hint-text">and {tipModes.length - 8} more — zoom in to tell them apart</div>}
            </div>
          )}
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
