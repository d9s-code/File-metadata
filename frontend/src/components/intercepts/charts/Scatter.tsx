import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { fmt, niceTicks, useWidth } from "./Histogram";

const DEFAULT_HEIGHT = 300;
// Room at the top for the vertical axis title.
const M = { left: 56, right: 12, top: 24, bottom: 34 };

export interface ScatterPoint {
  x: number;
  y: number;
  /** Matches a Mode on RF, PRI and PW; null when there's nothing to compare with. */
  matched: boolean | null;
  /** Marked by the user; when any point is, the rest are faded. */
  marked?: boolean;
}

type Box = { x: [number, number]; y: [number, number] };

/** A group's extent on the two axes, outlined over the points. */
export interface ScatterBox {
  x: [number, number];
  y: [number, number];
  count: number;
}

/** Reports by RF and PRI (a stagger's frame time) — where clusters show up
 * as clumps. Points matching a Mode and points outside every Mode get the two
 * chart colours; groups can be outlined as boxes. Drag a box to filter to it;
 * click to clear. Drawn on a canvas so tens of thousands of points stay quick. */
export function Scatter({
  header,
  xAxis,
  yAxis,
  points,
  xDomain,
  yDomain,
  selection,
  onSelect,
  boxes = [],
  boxStyle = "solid",
  height: HEIGHT = DEFAULT_HEIGHT,
  xTicks,
  xFormat = fmt,
  emptyText = "No pulsed reports in view.",
  markBoxes = [],
  noun = ["report", "reports"],
  shownCount,
  onYZoom,
  yZoomed = false,
}: {
  /** Given, dragging up or down along the value axis zooms it to that range;
   * null (from the Reset button) goes back to the automatic range. */
  onYZoom?: (range: [number, number] | null) => void;
  /** The value axis is zoomed — shows the Reset button. */
  yZoomed?: boolean;
  /** How many points fall in the visible stretch, when zoomed — read as "N of M". */
  shownCount?: number;
  /** Boxes the user marked on this chart; a narrowing one is dashed. */
  markBoxes?: (Box & { narrow?: boolean })[];
  height?: number;
  /** Ticks along the bottom, when round numbers aren't right (times). */
  xTicks?: (lo: number, hi: number) => number[];
  /** How x values read on the axis and in the hover read-out. */
  xFormat?: (v: number, step?: number) => string;
  emptyText?: string;
  points: ScatterPoint[];
  /** Group extents to outline. */
  boxes?: ScatterBox[];
  /** Dashed for a preview, solid for the groups as they are, faint for context. */
  boxStyle?: "solid" | "dashed" | "faint";
  /** What the points are, for the count in the header. */
  noun?: [string, string];
  /** The left of the card header — the title and axis pickers. */
  header: ReactNode;
  /** Short names and units, for the hover read-out and axis titles. */
  xAxis: { short: string; unit: string };
  yAxis: { short: string; unit: string };
  xDomain: [number, number];
  yDomain: [number, number];
  selection: Box | null;
  /** A dragged box, or null for a click; `add` when Shift was held, `narrow` with Ctrl, ⌘ or Alt. */
  onSelect: (box: Box | null, opts: { add: boolean; narrow: boolean }) => void;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // `axis`: started on the value axis — a vertical zoom, not a box.
  type Drag = { x0: number; y0: number; x1: number; y1: number; axis?: boolean };
  const [drag, setDragState] = useState<Drag | null>(null);
  // The live drag, for the pointer handlers — state can lag a fast drag by a render.
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };
  const [hover, setHover] = useState<{ px: number; py: number } | null>(null);
  const clipId = `scatter-clip-${useId().replace(/:/g, "")}`;

  const plotW = Math.max(10, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom;
  const [xl, xh] = xDomain;
  const [yl, yh] = yDomain;
  const sx = (v: number) => M.left + ((v - xl) / (xh - xl || 1)) * plotW;
  const sy = (v: number) => M.top + plotH - ((v - yl) / (yh - yl || 1)) * plotH;
  const ix = (px: number) => xl + ((px - M.left) / plotW) * (xh - xl);
  const iy = (py: number) => yl + ((M.top + plotH - py) / plotH) * (yh - yl);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = HEIGHT * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);
    const style = getComputedStyle(canvas);
    const inColor = style.getPropertyValue("--viz-in").trim() || "#2a78d6";
    const outColor = style.getPropertyValue("--viz-out").trim() || "#eb6834";
    const singleColor =
      style.getPropertyValue("--viz-single").trim() || inColor;
    const mutedColor =
      style.getPropertyValue("--viz-ink-muted").trim() || "#898781";
    const draw = (only: (p: ScatterPoint) => boolean, alpha: number, size: number, muted = false) => {
      // Matched first, unmatched on top: the ones that need attention stay visible.
      for (const pass of [true, false]) {
        ctx.fillStyle = muted ? mutedColor : pass ? inColor : outColor;
        ctx.globalAlpha = alpha;
        for (const p of points) {
          const matched = p.matched ?? true;
          if (matched !== pass || !only(p)) continue;
          if (p.x < xl || p.x > xh || p.y < yl || p.y > yh) continue;
          if (p.matched == null && !muted) ctx.fillStyle = singleColor;
          ctx.fillRect(sx(p.x) - size / 2, sy(p.y) - size / 2, size, size);
        }
      }
    };
    // A handful of points (an Intercept's few entries) are drawn larger, so they read at a glance.
    const base = points.length <= 50 ? 6 : 3;
    if (points.some((p) => p.marked)) {
      // Marked points keep their colours; the rest are faint grey context.
      draw((p) => !p.marked, 0.18, base, true);
      draw((p) => !!p.marked, 0.9, base + 0.5);
    } else draw(() => true, points.length <= 50 ? 0.85 : 0.55, base);
    ctx.globalAlpha = 1;
    // sx/sy derive from the domains and width listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, width, xl, xh, yl, yh]);

  function local(e: PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  }
  const axisDrag = drag?.axis ? drag : null;
  const box = axisDrag
    ? null
    : drag
    ? {
        x: Math.min(drag.x0, drag.x1),
        y: Math.min(drag.y0, drag.y1),
        w: Math.abs(drag.x1 - drag.x0),
        h: Math.abs(drag.y1 - drag.y0),
      }
    : // Zoomed to the selection, it would shade the whole chart — the zoom shows it.
      selection &&
        !(selection.x[0] <= xl && selection.x[1] >= xh && selection.y[0] <= yl && selection.y[1] >= yh)
      ? {
          x: sx(Math.max(selection.x[0], xl)),
          y: sy(Math.min(selection.y[1], yh)),
          w:
            sx(Math.min(selection.x[1], xh)) - sx(Math.max(selection.x[0], xl)),
          h:
            sy(Math.max(selection.y[0], yl)) - sy(Math.min(selection.y[1], yh)),
        }
      : null;

  return (
    <div className="viz-card viz-card-wide">
      <div className="viz-card-header">
        {header}
        <span className="hint-text">
          {yZoomed && onYZoom && (
            <>
              <button
                type="button"
                className="link-button viz-yzoom-reset"
                title={`Back to the automatic ${yAxis.short} range`}
                onClick={() => onYZoom(null)}
              >
                Reset {yAxis.short} zoom
              </button>
              {" · "}
            </>
          )}
          {shownCount != null && shownCount !== points.length && `${shownCount.toLocaleString()} of `}
          {points.length.toLocaleString()} {points.length === 1 ? noun[0] : noun[1]}
          {hover && (
            <>
              {" · "}
              {xAxis.short} {xFormat(ix(hover.px))}
              {xAxis.unit && ` ${xAxis.unit}`}, {yAxis.short}{" "}
              {fmt(iy(hover.py))} {yAxis.unit}
            </>
          )}
        </span>
      </div>
      <div
        ref={ref}
        className="viz-plot viz-brushable"
        style={{ height: HEIGHT }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const { px, py } = local(e);
          const axis = !!onYZoom && points.length > 0 && px < M.left && py >= M.top && py <= M.top + plotH;
          setDrag({ x0: px, y0: py, x1: px, y1: py, axis });
        }}
        onPointerMove={(e) => {
          const { px, py } = local(e);
          if (dragRef.current) setDrag({ ...dragRef.current, x1: px, y1: py });
          const inside =
            px >= M.left &&
            px <= M.left + plotW &&
            py >= M.top &&
            py <= M.top + plotH;
          setHover(inside ? { px, py } : null);
        }}
        onPointerUp={(e) => {
          if (!dragRef.current) return;
          const end = local(e);
          const drag = { ...dragRef.current, x1: end.px, y1: end.py };
          if (drag.axis) {
            setDrag(null);
            // Clamped to the plot, so a drag past either end stops at the axis's current edge.
            const clampY = (py: number) => Math.min(Math.max(py, M.top), M.top + plotH);
            if (Math.abs(drag.y1 - drag.y0) >= 4 && onYZoom) {
              const ys = [iy(clampY(drag.y0)), iy(clampY(drag.y1))].sort((a, b) => a - b) as [number, number];
              onYZoom(ys);
            }
            return;
          }
          if (
            Math.abs(drag.x1 - drag.x0) < 4 &&
            Math.abs(drag.y1 - drag.y0) < 4
          )
            onSelect(null, { add: e.shiftKey, narrow: e.ctrlKey || e.metaKey || e.altKey });
          else {
            const xs = [ix(drag.x0), ix(drag.x1)].sort((a, b) => a - b) as [
              number,
              number,
            ];
            const ys = [iy(drag.y0), iy(drag.y1)].sort((a, b) => a - b) as [
              number,
              number,
            ];
            onSelect({ x: xs, y: ys }, { add: e.shiftKey, narrow: e.ctrlKey || e.metaKey || e.altKey });
          }
          setDrag(null);
        }}
        onPointerLeave={() => setHover(null)}
      >
        {points.length === 0 ? (
          <p className="hint-text viz-empty">{emptyText}</p>
        ) : (
          <>
            {onYZoom && (
              <div
                className="viz-yzoom-handle"
                style={{ top: M.top, width: M.left - 2, height: plotH }}
                title={`Drag up or down here to zoom the ${yAxis.short} axis`}
              />
            )}
            <canvas
              ref={canvasRef}
              className="viz-canvas"
              style={{ width, height: HEIGHT }}
            />
            <svg
              width={width}
              height={HEIGHT}
              className="viz-overlay"
              aria-label={`${xAxis.short} against ${yAxis.short} scatter`}
            >
              {niceTicks(yl, yh, 5).map((t) => (
                <g key={`y${t}`}>
                  <line
                    className="viz-grid"
                    x1={M.left}
                    x2={M.left + plotW}
                    y1={sy(t)}
                    y2={sy(t)}
                  />
                  <text
                    className="viz-axis-label"
                    x={M.left - 6}
                    y={sy(t) + 4}
                    textAnchor="end"
                  >
                    {fmt(t)}
                  </text>
                </g>
              ))}
              {(() => {
                const ticks = xTicks ? xTicks(xl, xh) : niceTicks(xl, xh, 6);
                const step = ticks.length > 1 ? ticks[1] - ticks[0] : undefined;
                return ticks.map((t) => (
                  <text
                    key={`x${t}`}
                    className="viz-axis-label"
                    x={sx(t)}
                    y={HEIGHT - 10}
                    textAnchor="middle"
                  >
                    {xTicks ? xFormat(t, step) : fmt(t)}
                  </text>
                ));
              })()}
              <line
                className="viz-baseline"
                x1={M.left}
                x2={M.left + plotW}
                y1={M.top + plotH}
                y2={M.top + plotH}
              />
              <text className="viz-axis-label map-axis-title" x={6} y={13}>
                {yAxis.short} ({yAxis.unit})
              </text>
              <text
                className="viz-axis-label map-axis-title"
                x={M.left + plotW}
                y={HEIGHT - 10}
                textAnchor="end"
              >
                {xAxis.unit ? `${xAxis.short} (${xAxis.unit})` : xAxis.short}
              </text>
              <defs>
                <clipPath id={clipId}>
                  <rect x={M.left} y={M.top} width={plotW} height={plotH} />
                </clipPath>
              </defs>
              <g clipPath={`url(#${clipId})`}>
                {boxes.map((b, i) => {
                  if (b.x[1] < xl || b.x[0] > xh || b.y[1] < yl || b.y[0] > yh) return null;
                  // At least a few pixels, so a tight group is still visible as a box.
                  const x0 = sx(b.x[0]);
                  const x1 = sx(b.x[1]);
                  const y0 = sy(b.y[1]);
                  const y1 = sy(b.y[0]);
                  const w = Math.max(8, x1 - x0);
                  const h = Math.max(8, y1 - y0);
                  return (
                    <rect
                      key={i}
                      className={boxStyle === "solid" ? "viz-groupbox" : `viz-groupbox ${boxStyle}`}
                      x={(x0 + x1) / 2 - w / 2}
                      y={(y0 + y1) / 2 - h / 2}
                      width={w}
                      height={h}
                    />
                  );
                })}
              </g>
              {markBoxes.map((m, i) => {
                if (m.x[1] < xl || m.x[0] > xh || m.y[1] < yl || m.y[0] > yh) return null;
                const x0 = sx(Math.max(m.x[0], xl));
                const x1 = sx(Math.min(m.x[1], xh));
                const y0 = sy(Math.min(m.y[1], yh));
                const y1 = sy(Math.max(m.y[0], yl));
                return (
                  <rect key={`m${i}`} className={m.narrow ? "viz-mark narrow" : "viz-mark"} x={x0} y={y0} width={Math.max(1, x1 - x0)} height={Math.max(1, y1 - y0)} />
                );
              })}
              {axisDrag && (() => {
                const clampY = (py: number) => Math.min(Math.max(py, M.top), M.top + plotH);
                const y0 = clampY(Math.min(axisDrag.y0, axisDrag.y1));
                const y1 = clampY(Math.max(axisDrag.y0, axisDrag.y1));
                return y1 - y0 > 0 ? (
                  <rect className="viz-yzoom-band" x={0} y={y0} width={M.left + plotW} height={y1 - y0} />
                ) : null;
              })()}
              {box && box.w > 0 && box.h > 0 && (
                <rect
                  className="viz-selection"
                  x={box.x}
                  y={box.y}
                  width={box.w}
                  height={box.h}
                />
              )}
            </svg>
          </>
        )}
      </div>
    </div>
  );
}
