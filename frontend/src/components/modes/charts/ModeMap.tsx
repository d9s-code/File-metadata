import { useMemo, useRef, useState, type PointerEvent } from "react";
import { fmt, niceTicks, useWidth } from "../../intercepts/charts/Histogram";
import { domainOf, resultStatus, type ModeRanges, type Span } from "./modeRanges";
import type { Mode } from "../../../types/domain";

const HEIGHT = 380;
const STRIP = 30;
const M = { left: 58, right: 14, top: 12, bottom: 34 };

export interface MapEntry {
  rf: number;
  /** PRI, or a stagger's frame time. */
  pri: number | null;
  matched: boolean;
  label: string;
}

/** Each Mode as a rectangle over its engineered RF and PRI (a stagger's frame
 * time), coloured by its last test result: overlaps show as darker, layered
 * areas, gaps as empty space. Modes without a PRI (CW, X-let) sit in a strip
 * under the plot, by RF. Intercept entries are dots (matching a Mode) or
 * crosses (outside every Mode). Hover to see which Modes are under the
 * pointer; click to open one; drag to zoom. */
export function ModeMap({
  ranges,
  entries,
  fitEntries,
  onOpen,
}: {
  ranges: ModeRanges[];
  entries: MapEntry[];
  /** Fit the axes to the entries as well as the Modes. */
  fitEntries: boolean;
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

  const withPri = useMemo(() => ranges.filter((r) => r.pri), [ranges]);
  const noPri = useMemo(() => ranges.filter((r) => !r.pri), [ranges]);
  const full = useMemo(
    () => ({
      x: domainOf(
        ranges.map((r) => r.rf),
        fitEntries ? entries.map((e) => e.rf) : [],
      ),
      y: domainOf(
        withPri.map((r) => r.pri),
        fitEntries ? entries.flatMap((e) => (e.pri == null ? [] : [e.pri])) : [],
      ),
    }),
    [ranges, withPri, entries, fitEntries],
  );
  const [xl, xh] = zoom?.x ?? full.x;
  const [yl, yh] = zoom?.y ?? full.y;
  const plotW = Math.max(10, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom - (noPri.length ? STRIP + 8 : 0);
  const sx = (v: number) => M.left + ((v - xl) / (xh - xl || 1)) * plotW;
  const sy = (v: number) => M.top + plotH - ((v - yl) / (yh - yl || 1)) * plotH;
  const ix = (px: number) => xl + ((px - M.left) / plotW) * (xh - xl);
  const iy = (py: number) => yl + ((M.top + plotH - py) / plotH) * (yh - yl);
  const stripY = M.top + plotH + 26;

  // Larger rectangles first, so smaller ones stay on top and clickable.
  const drawOrder = useMemo(
    () =>
      [...withPri].sort(
        (a, b) => (b.rf[1] - b.rf[0]) * (b.pri![1] - b.pri![0]) - (a.rf[1] - a.rf[0]) * (a.pri![1] - a.pri![0]),
      ),
    [withPri],
  );

  // Modes under the pointer, smallest first (the one a click opens).
  const under = useMemo(() => {
    if (!hover || drag) return [];
    const { px, py } = hover;
    const x = ix(px);
    if (noPri.length && py >= stripY - 4 && py <= stripY + STRIP) {
      return noPri.filter((r) => x >= r.rf[0] && x <= r.rf[1]);
    }
    const y = iy(py);
    return drawOrder
      .filter((r) => x >= r.rf[0] && x <= r.rf[1] && y >= r.pri![0] && y <= r.pri![1])
      .reverse();
    // ix/iy follow the domains and width, all listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, drag, drawOrder, noPri, xl, xh, yl, yh, width]);

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

  return (
    <div className="viz-card">
      <div className="viz-card-header">
        <strong>
          Parameter map <span className="hint-text">(RF in MHz × PRI in µs; a stagger&apos;s frame time)</span>
        </strong>
        <span className="hint-text">
          {zoom && (
            <>
              <button type="button" className="link-button" onClick={() => setZoom(null)}>
                Reset zoom
              </button>{" "}
              ·{" "}
            </>
          )}
          {hover && !drag ? `${fmt(ix(hover.px))} MHz, ${fmt(iy(hover.py))} µs` : "Drag to zoom · click a Mode to open it"}
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
        <svg width={width} height={HEIGHT} aria-label="Modes on RF and PRI">
          <defs>
            <clipPath id="mode-map-plot">
              <rect x={M.left} y={M.top} width={plotW} height={plotH} />
            </clipPath>
            <clipPath id="mode-map-strip">
              <rect x={M.left} y={stripY - 4} width={plotW} height={STRIP + 8} />
            </clipPath>
          </defs>
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
              const x = sx(r.rf[0]);
              const y = sy(r.pri![1]);
              const w = Math.max(2, sx(r.rf[1]) - x);
              const h = Math.max(2, sy(r.pri![0]) - y);
              const hovered = under[0]?.mode.id === r.mode.id;
              return (
                <rect
                  key={r.mode.id}
                  className={`map-mode ${status.cls}${hovered ? " hovered" : ""}`}
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                />
              );
            })}
            {entries.map((e, i) => {
              if (e.pri == null) return null;
              const x = sx(e.rf);
              const y = sy(e.pri);
              return e.matched ? (
                <circle key={i} className="map-entry" cx={x} cy={y} r={3.5} />
              ) : (
                <path key={i} className="map-entry-out" d={`M${x - 4} ${y - 4}L${x + 4} ${y + 4}M${x + 4} ${y - 4}L${x - 4} ${y + 4}`} />
              );
            })}
          </g>
          <line className="viz-baseline" x1={M.left} x2={M.left + plotW} y1={M.top + plotH} y2={M.top + plotH} />
          {noPri.length > 0 && (
            <g>
              <text className="viz-axis-label" x={M.left - 6} y={stripY + STRIP / 2 + 4} textAnchor="end">
                no PRI
              </text>
              <g clipPath="url(#mode-map-strip)">
                {noPri.map((r, i) => {
                  const status = resultStatus(r.mode);
                  const x = sx(r.rf[0]);
                  const lane = i % 3;
                  return (
                    <rect
                      key={r.mode.id}
                      className={`map-mode ${status.cls}${under[0]?.mode.id === r.mode.id ? " hovered" : ""}`}
                      x={x}
                      y={stripY + lane * 10}
                      width={Math.max(2, sx(r.rf[1]) - x)}
                      height={8}
                    />
                  );
                })}
                {entries.map((e, i) =>
                  e.pri == null ? (
                    <circle
                      key={`cw${i}`}
                      className={e.matched ? "map-entry" : "map-entry-out-dot"}
                      cx={sx(e.rf)}
                      cy={stripY + STRIP / 2}
                      r={3.5}
                    />
                  ) : null,
                )}
              </g>
            </g>
          )}
          {niceTicks(xl, xh, 6).map((t) => (
            <text key={`x${t}`} className="viz-axis-label" x={sx(t)} y={HEIGHT - 10} textAnchor="middle">
              {fmt(t)}
            </text>
          ))}
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
