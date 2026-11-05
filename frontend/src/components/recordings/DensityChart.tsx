import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { fmt, niceTicks, useWidth } from "../intercepts/charts/Histogram";
import { formatTime, timeTicks } from "../intercepts/charts/timeAxis";

const M = { left: 64, right: 12, top: 22, bottom: 30 };

/** A box dragged on a chart: a time window (ms) and, on a value chart, a value range. */
export interface DensityBox {
  t: [number, number];
  v?: [number, number];
}

/** Shade for a cell holding `n` of at most `max` reports: one hue, more
 * reports darker (in the light theme) or brighter (dark) — on a log scale, so
 * a few stray reports still show next to a dense emitter. */
function alphaFor(n: number, max: number) {
  return 0.18 + 0.82 * (Math.log1p(n) / Math.log1p(Math.max(1, max)));
}

/** What a recording looks like over time: for each of `bins` time steps and
 * value steps, how many reports — drawn as shaded cells rather than a million
 * dots. Drag a box to snip to it (time and value); with `countsOnly` it's the
 * report count over time, and a drag picks the time only. */
export function DensityChart({
  title,
  unit,
  time,
  values,
  cells,
  counts,
  height = 190,
  onSnip,
}: {
  title: string;
  unit: string;
  /** Seconds since 1970, and how many steps the time is split into. */
  time: { min: number; max: number; bins: number };
  /** The value axis and its steps; absent for the count chart. */
  values?: { min: number; max: number; bins: number };
  cells?: [number, number, number][];
  /** [time bin, count] — for the count chart. */
  counts?: [number, number][];
  height?: number;
  onSnip: (box: DensityBox) => void;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drag, setDragState] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const dragRef = useRef(drag);
  const setDrag = (d: typeof drag) => {
    dragRef.current = d;
    setDragState(d);
  };
  const [hover, setHover] = useState<{ px: number; py: number } | null>(null);
  // Counts by cell, for the hover read-out (tens of thousands of cells).
  const byCell = useMemo(() => {
    const m = new Map<number, number>();
    for (const [tb, vb, n] of cells ?? []) m.set(tb * 100_000 + vb, n);
    for (const [tb, n] of counts ?? []) m.set(tb * 100_000 - 1, n);
    return m;
  }, [cells, counts]);

  const plotW = Math.max(10, width - M.left - M.right);
  const plotH = height - M.top - M.bottom;
  const t0 = time.min * 1000;
  const t1 = Math.max(time.max * 1000, t0 + 1);
  const sx = (ms: number) => M.left + ((ms - t0) / (t1 - t0)) * plotW;
  const ix = (px: number) => t0 + ((Math.min(Math.max(px, M.left), M.left + plotW) - M.left) / plotW) * (t1 - t0);
  // A little room above and below the values, so a line at either end isn't under the axis.
  const dataSpan = values ? Math.max(values.max - values.min, Math.abs(values.max) * 1e-6, 1e-9) : 0;
  const vLo = values ? values.min - dataSpan * 0.04 : 0;
  const vHi = values ? values.max + dataSpan * 0.04 : Math.max(1, ...(counts ?? []).map((c) => c[1])) * 1.08;
  const sy = (v: number) => M.top + plotH - ((v - vLo) / (vHi - vLo)) * plotH;
  const iy = (py: number) => vLo + ((M.top + plotH - Math.min(Math.max(py, M.top), M.top + plotH)) / plotH) * (vHi - vLo);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue("--viz-in").trim() || "#2a78d6";
    const cw = plotW / time.bins;
    if (values && cells) {
      const step = (values.max - values.min) / values.bins;
      const ch = Math.abs(sy(values.min) - sy(values.min + step));
      const max = cells.reduce((m, c) => Math.max(m, c[2]), 1);
      for (const [tb, vb, n] of cells) {
        ctx.globalAlpha = alphaFor(n, max);
        // At least a pixel each way, so a lone report still shows.
        ctx.fillRect(M.left + tb * cw, sy(values.min + (vb + 1) * step), Math.max(1, cw), Math.max(1, ch));
      }
    } else if (counts) {
      ctx.globalAlpha = 0.85;
      for (const [tb, n] of counts) {
        const y = sy(n);
        // A 1px surface gap between neighbouring bars when they're wide enough for it.
        ctx.fillRect(M.left + tb * cw, y, Math.max(1, cw - (cw > 3 ? 1 : 0)), M.top + plotH - y);
      }
    }
    ctx.globalAlpha = 1;
    // sx/sy follow from the props listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, counts, width, height, time.min, time.max, time.bins, values?.min, values?.max, values?.bins]);

  function local(e: PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  }

  // The read-out under the pointer: time, value and the cell's count.
  let readout: string | null = null;
  if (hover && !drag) {
    const ms = ix(hover.px);
    const tb = Math.min(time.bins - 1, Math.floor(((ms - t0) / (t1 - t0)) * time.bins));
    if (values && cells) {
      const v = iy(hover.py);
      const vb = Math.min(values.bins - 1, Math.floor(((v - values.min) / Math.max(values.max - values.min, 1e-9)) * values.bins));
      const n = byCell.get(tb * 100_000 + vb) ?? 0;
      readout = `${formatTime(ms)} · ${title} ${fmt(v)} ${unit} · ${n.toLocaleString()} report${n === 1 ? "" : "s"}`;
    } else if (counts) {
      const n = byCell.get(tb * 100_000 - 1) ?? 0;
      readout = `${formatTime(ms)} · ${n.toLocaleString()} report${n === 1 ? "" : "s"}`;
    }
  }

  const ticks = timeTicks(t0, t1, Math.max(2, Math.floor(plotW / 110)));
  const step = ticks.length > 1 ? ticks[1] - ticks[0] : undefined;
  const box = drag
    ? values
      ? { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) }
      : { x: Math.min(drag.x0, drag.x1), y: M.top, w: Math.abs(drag.x1 - drag.x0), h: plotH }
    : null;
  const empty = values ? !cells || cells.length === 0 : !counts || counts.length === 0;

  return (
    <div className="viz-card viz-card-wide recording-chart">
      <div className="viz-card-header">
        <h2 className="as-h4">{values ? `${title} over time` : "Reports over time"}</h2>
        <span className="hint-text">{readout ?? (values ? "Drag a box to snip to it" : "Drag across to snip to that time")}</span>
      </div>
      <div
        ref={ref}
        className="viz-plot viz-brushable"
        style={{ height }}
        onPointerDown={(e) => {
          if (empty) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const { px, py } = local(e);
          setDrag({ x0: px, y0: py, x1: px, y1: py });
        }}
        onPointerMove={(e) => {
          const { px, py } = local(e);
          if (dragRef.current) setDrag({ ...dragRef.current, x1: px, y1: py });
          const inside = px >= M.left && px <= M.left + plotW && py >= M.top && py <= M.top + plotH;
          setHover(inside ? { px, py } : null);
        }}
        onPointerUp={() => {
          const d = dragRef.current;
          setDrag(null);
          if (!d || Math.abs(d.x1 - d.x0) < 4) return;
          const t: [number, number] = [ix(Math.min(d.x0, d.x1)), ix(Math.max(d.x0, d.x1))];
          if (values && Math.abs(d.y1 - d.y0) >= 4) {
            onSnip({ t, v: [iy(Math.max(d.y0, d.y1)), iy(Math.min(d.y0, d.y1))] });
          } else onSnip({ t });
        }}
        onPointerLeave={() => setHover(null)}
      >
        {empty ? (
          <p className="hint-text viz-empty">{values ? `No ${title} values in this snip.` : "No timed reports in this snip."}</p>
        ) : (
          <>
            <canvas ref={canvasRef} className="viz-canvas" style={{ width, height }} />
            <svg width={width} height={height} className="viz-overlay" aria-label={values ? `${title} over time` : "Reports over time"}>
              {niceTicks(vLo, vHi, values ? 4 : 2).map((v) => (
                <g key={`y${v}`}>
                  <line className="viz-grid" x1={M.left} x2={M.left + plotW} y1={sy(v)} y2={sy(v)} />
                  <text className="viz-axis-label" x={M.left - 6} y={sy(v) + 4} textAnchor="end">
                    {fmt(v)}
                  </text>
                </g>
              ))}
              {ticks.map((t) => (
                <text key={`x${t}`} className="viz-axis-label" x={sx(t)} y={height - 9} textAnchor="middle">
                  {formatTime(t, step)}
                </text>
              ))}
              <line className="viz-baseline" x1={M.left} x2={M.left + plotW} y1={M.top + plotH} y2={M.top + plotH} />
              <text className="viz-axis-label map-axis-title" x={6} y={13}>
                {values ? `${title} (${unit})` : "Reports"}
              </text>
              {box && box.w > 0 && box.h > 0 && <rect className="viz-selection" x={box.x} y={box.y} width={box.w} height={box.h} />}
            </svg>
          </>
        )}
      </div>
    </div>
  );
}
