import { useMemo, useRef, useState, type PointerEvent } from "react";
import { fmt, niceTicks, useWidth } from "../../intercepts/charts/Histogram";
import { domainOf, resultStatus, type ModeRanges, type Span } from "./modeRanges";
import type { Mode } from "../../../types/domain";

const HEIGHT = 380;
const STRIP = 30;
// Room at the top for the vertical axis title.
const M = { left: 58, right: 14, top: 24, bottom: 34 };

export type MapParam = "rf" | "pri" | "pw";

export const MAP_PARAMS: Record<MapParam, { label: string; short: string; unit: string }> = {
  rf: { label: "RF", short: "RF", unit: "MHz" },
  pri: { label: "PRI (frame time for a stagger)", short: "PRI", unit: "µs" },
  pw: { label: "PW", short: "PW", unit: "µs" },
};

export interface MapEntry {
  rf: number;
  /** PRI, or a stagger's frame time; null for CW. */
  pri: number | null;
  pw: number | null;
  matched: boolean;
  label: string;
}

export const spanOf = (r: ModeRanges, p: MapParam): Span | null => (p === "rf" ? r.rf : p === "pri" ? r.pri : r.pw);
export const valueOf = (e: MapEntry, p: MapParam): number | null => (p === "rf" ? e.rf : p === "pri" ? e.pri : e.pw);

/** Each Mode as a rectangle over its engineered ranges on two chosen
 * parameters, coloured by its last test result: overlaps show as darker,
 * layered areas, gaps as empty space. Modes without the vertical parameter
 * (CW has no PRI or PW) sit in a strip under the plot, by the horizontal one.
 * Intercept entries are dots (matching a Mode) or crosses (outside every
 * Mode). Hover to see which Modes are under the pointer; click to open one;
 * drag to zoom. */
export function ModeMap({
  ranges,
  entries,
  fitEntries,
  xParam,
  yParam,
  onAxes,
  onOpen,
}: {
  ranges: ModeRanges[];
  entries: MapEntry[];
  /** Fit the axes to the entries as well as the Modes. */
  fitEntries: boolean;
  xParam: MapParam;
  yParam: MapParam;
  onAxes: (x: MapParam, y: MapParam) => void;
  onOpen: (mode: Mode) => void;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [zoom, setZoom] = useState<{ x: Span; y: Span } | null>(null);
  const [hover, setHover] = useState<{ px: number; py: number } | null>(null);
  const [drag, setDragState] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const dragRef = useRef(drag);
  const setDrag = (d: typeof drag) => {
    dragRef.current = d;
    setDragState(d);
  };
  const X = MAP_PARAMS[xParam];
  const Y = MAP_PARAMS[yParam];

  const onX = useMemo(() => ranges.filter((r) => spanOf(r, xParam)), [ranges, xParam]);
  const both = useMemo(() => onX.filter((r) => spanOf(r, yParam)), [onX, yParam]);
  const xOnly = useMemo(() => onX.filter((r) => !spanOf(r, yParam)), [onX, yParam]);
  const full = useMemo(() => {
    const vals = (p: MapParam) => (fitEntries ? entries.flatMap((e) => (valueOf(e, p) == null ? [] : [valueOf(e, p)!])) : []);
    return {
      x: domainOf(
        onX.map((r) => spanOf(r, xParam)),
        vals(xParam),
      ),
      y: domainOf(
        both.map((r) => spanOf(r, yParam)),
        vals(yParam),
      ),
    };
  }, [onX, both, entries, fitEntries, xParam, yParam]);
  const [xl, xh] = zoom?.x ?? full.x;
  const [yl, yh] = zoom?.y ?? full.y;
  const plotW = Math.max(10, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom - (xOnly.length ? STRIP + 8 : 0);
  const sx = (v: number) => M.left + ((v - xl) / (xh - xl || 1)) * plotW;
  const sy = (v: number) => M.top + plotH - ((v - yl) / (yh - yl || 1)) * plotH;
  const ix = (px: number) => xl + ((px - M.left) / plotW) * (xh - xl);
  const iy = (py: number) => yl + ((M.top + plotH - py) / plotH) * (yh - yl);
  const stripY = M.top + plotH + 26;

  function changeAxes(x: MapParam, y: MapParam) {
    setZoom(null);
    onAxes(x, y);
  }

  // Larger rectangles first, so smaller ones stay on top and clickable.
  const drawOrder = useMemo(() => {
    const area = (r: ModeRanges) => {
      const a = spanOf(r, xParam)!;
      const b = spanOf(r, yParam)!;
      return (a[1] - a[0]) * (b[1] - b[0]);
    };
    return [...both].sort((a, b) => area(b) - area(a));
  }, [both, xParam, yParam]);

  // Modes under the pointer, smallest first (the one a click opens).
  const under = useMemo(() => {
    if (!hover || drag) return [];
    const { px, py } = hover;
    const x = ix(px);
    const inX = (r: ModeRanges) => {
      const s = spanOf(r, xParam)!;
      return x >= s[0] && x <= s[1];
    };
    if (xOnly.length && py >= stripY - 4 && py <= stripY + STRIP) return xOnly.filter(inX);
    const y = iy(py);
    return drawOrder
      .filter((r) => {
        const s = spanOf(r, yParam)!;
        return inX(r) && y >= s[0] && y <= s[1];
      })
      .reverse();
    // ix/iy follow the domains and width, all listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, drag, drawOrder, xOnly, xl, xh, yl, yh, width, xParam, yParam]);

  function local(e: PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  }

  const box = drag && {
    x: Math.min(drag.x0, drag.x1),
    y: Math.min(drag.y0, drag.y1),
    w: Math.abs(drag.x1 - drag.x0),
    h: Math.abs(drag.y1 - drag.y0),
  };
  const axisSelect = (value: MapParam, other: MapParam, set: (p: MapParam) => void, label: string) => (
    <label className="inline-label map-axis">
      {label}
      <select value={value} onChange={(e) => set(e.target.value as MapParam)}>
        {(Object.keys(MAP_PARAMS) as MapParam[]).map((p) => (
          <option key={p} value={p} disabled={p === other}>
            {MAP_PARAMS[p].short}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="viz-card">
      <div className="viz-card-header">
        <span className="map-axes">
          <strong>Parameter map</strong>
          {axisSelect(xParam, yParam, (x) => changeAxes(x, yParam), "Across")}
          {axisSelect(yParam, xParam, (y) => changeAxes(xParam, y), "Up")}
          <button type="button" className="link-button" onClick={() => changeAxes(yParam, xParam)} title="Swap the axes">
            ⇄ Swap
          </button>
        </span>
        <span className="hint-text">
          {zoom && (
            <>
              <button type="button" className="link-button" onClick={() => setZoom(null)}>
                Reset zoom
              </button>{" "}
              ·{" "}
            </>
          )}
          {hover && !drag
            ? `${X.short} ${fmt(ix(hover.px))} ${X.unit}, ${Y.short} ${fmt(iy(hover.py))} ${Y.unit}`
            : "Drag to zoom · click a Mode to open it"}
        </span>
      </div>
      <div
        ref={ref}
        className="viz-plot viz-brushable"
        style={{ height: HEIGHT }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const { px, py } = local(e);
          setDrag({ x0: px, y0: py, x1: px, y1: py });
        }}
        onPointerMove={(e) => {
          const p = local(e);
          if (dragRef.current) setDrag({ ...dragRef.current, x1: p.px, y1: p.py });
          setHover(p);
        }}
        onPointerUp={(e) => {
          const d = dragRef.current;
          setDrag(null);
          if (!d) return;
          const end = local(e);
          if (Math.abs(end.px - d.x0) < 5 && Math.abs(end.py - d.y0) < 5) {
            if (under[0]) onOpen(under[0].mode);
            return;
          }
          const xs = [ix(d.x0), ix(end.px)].sort((a, b) => a - b) as Span;
          const ys = [iy(d.y0), iy(end.py)].sort((a, b) => a - b) as Span;
          setZoom({ x: xs, y: ys });
        }}
        onPointerLeave={() => setHover(null)}
      >
        <svg width={width} height={HEIGHT} aria-label={`Modes on ${X.short} and ${Y.short}`}>
          <defs>
            <clipPath id="mode-map-plot">
              <rect x={M.left} y={M.top} width={plotW} height={plotH} />
            </clipPath>
            <clipPath id="mode-map-strip">
              <rect x={M.left} y={stripY - 4} width={plotW} height={STRIP + 8} />
            </clipPath>
          </defs>
          <text className="viz-axis-label map-axis-title" x={6} y={13} textAnchor="start">
            {Y.short} ({Y.unit})
          </text>
          {niceTicks(yl, yh, 5).map((t) => (
            <g key={`y${t}`}>
              <line className="viz-grid" x1={M.left} x2={M.left + plotW} y1={sy(t)} y2={sy(t)} />
              <text className="viz-axis-label" x={M.left - 6} y={sy(t) + 4} textAnchor="end">
                {fmt(t)}
              </text>
            </g>
          ))}
          <g clipPath="url(#mode-map-plot)">
            {drawOrder.map((r) => {
              const status = resultStatus(r.mode);
              const xs = spanOf(r, xParam)!;
              const ys = spanOf(r, yParam)!;
              const x = sx(xs[0]);
              const y = sy(ys[1]);
              const hovered = under[0]?.mode.id === r.mode.id;
              return (
                <rect
                  key={r.mode.id}
                  className={`map-mode ${status.cls}${hovered ? " hovered" : ""}`}
                  x={x}
                  y={y}
                  width={Math.max(2, sx(xs[1]) - x)}
                  height={Math.max(2, sy(ys[0]) - y)}
                />
              );
            })}
            {entries.map((e, i) => {
              const xv = valueOf(e, xParam);
              const yv = valueOf(e, yParam);
              if (xv == null || yv == null) return null;
              const x = sx(xv);
              const y = sy(yv);
              return e.matched ? (
                <circle key={i} className="map-entry" cx={x} cy={y} r={3.5} />
              ) : (
                <path key={i} className="map-entry-out" d={`M${x - 4} ${y - 4}L${x + 4} ${y + 4}M${x + 4} ${y - 4}L${x - 4} ${y + 4}`} />
              );
            })}
          </g>
          <line className="viz-baseline" x1={M.left} x2={M.left + plotW} y1={M.top + plotH} y2={M.top + plotH} />
          {xOnly.length > 0 && (
            <g>
              <text className="viz-axis-label" x={M.left - 6} y={stripY + STRIP / 2 + 4} textAnchor="end">
                no {Y.short}
              </text>
              <g clipPath="url(#mode-map-strip)">
                {xOnly.map((r, i) => {
                  const status = resultStatus(r.mode);
                  const xs = spanOf(r, xParam)!;
                  const x = sx(xs[0]);
                  return (
                    <rect
                      key={r.mode.id}
                      className={`map-mode ${status.cls}${under[0]?.mode.id === r.mode.id ? " hovered" : ""}`}
                      x={x}
                      y={stripY + (i % 3) * 10}
                      width={Math.max(2, sx(xs[1]) - x)}
                      height={8}
                    />
                  );
                })}
                {entries.map((e, i) => {
                  const xv = valueOf(e, xParam);
                  if (xv == null || valueOf(e, yParam) != null) return null;
                  return (
                    <circle
                      key={`s${i}`}
                      className={e.matched ? "map-entry" : "map-entry-out-dot"}
                      cx={sx(xv)}
                      cy={stripY + STRIP / 2}
                      r={3.5}
                    />
                  );
                })}
              </g>
            </g>
          )}
          {niceTicks(xl, xh, 6).map((t) => (
            <text key={`x${t}`} className="viz-axis-label" x={sx(t)} y={HEIGHT - 10} textAnchor="middle">
              {fmt(t)}
            </text>
          ))}
          <text className="viz-axis-label map-axis-title" x={M.left + plotW} y={HEIGHT - 10} textAnchor="end">
            {X.short} ({X.unit})
          </text>
          {box && box.w > 0 && box.h > 0 && <rect className="viz-selection" x={box.x} y={box.y} width={box.w} height={box.h} />}
        </svg>
        {under.length > 0 && hover && (
          <div className="viz-tooltip" style={{ left: Math.min(hover.px + 14, Math.max(8, width - 250)), top: Math.max(4, hover.py - 10) }}>
            {under.slice(0, 5).map((r, i) => (
              <div key={r.mode.id} className={i === 0 ? "map-tip-first" : undefined}>
                <span className={`viz-swatch ${resultStatus(r.mode).cls}`} /> {r.mode.name}{" "}
                <span className="hint-text">· {resultStatus(r.mode).label}</span>
                {i === 0 && (
                  <div className="hint-text">
                    RF {fmt(r.rf[0])}–{fmt(r.rf[1])}
                    {r.pri && ` · PRI ${fmt(r.pri[0])}–${fmt(r.pri[1])}`}
                    {r.pw && ` · PW ${fmt(r.pw[0])}–${fmt(r.pw[1])}`}
                  </div>
                )}
              </div>
            ))}
            {under.length > 1 && (
              <div className="hint-text">
                {under.length} Modes overlap here{under.length > 5 ? ` (${under.length - 5} more)` : ""}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
