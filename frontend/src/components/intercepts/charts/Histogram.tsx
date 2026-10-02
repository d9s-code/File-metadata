import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { Interval } from "./coverage";

const BINS = 48;
const HEIGHT = 168;
const M = { left: 40, right: 10, top: 14, bottom: 36 };

export function fmt(v: number): string {
  return v.toLocaleString(undefined, {
    maximumFractionDigits: Math.abs(v) >= 1000 ? 1 : 3,
  });
}

/** About five round-numbered ticks across a domain. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => span / s <= count) ??
    10 * mag;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + step * 1e-9; t += step)
    ticks.push(Math.round(t / step) * step);
  return ticks;
}

/** Width of the element, kept up to date. */
export function useWidth<T extends HTMLElement>() {
  // A callback ref, so measuring starts whenever the element appears — a chart
  // that first renders nothing (data still loading) still gets its width.
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, [el]);
  return { ref: setEl, width };
}

/** How many values fall in each of BINS bins, split by whether they're
 * within a Mode (when there's something to compare with). */
function binValues(
  values: number[],
  covered: boolean[] | null,
  [lo, hi]: [number, number],
) {
  const inside = Array.from({ length: BINS }, () => 0);
  const outside = Array.from({ length: BINS }, () => 0);
  const width = (hi - lo) / BINS || 1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v < lo || v > hi) continue;
    const b = Math.min(BINS - 1, Math.floor((v - lo) / width));
    if (!covered || covered[i]) inside[b]++;
    else outside[b]++;
  }
  return { inside, outside, width };
}

/** One parameter's distribution: a bar per value range, stacked by whether
 * those reports fall within a Mode. Under the axis, a strip shows where the
 * Modes reach; above the bars, ticks show where Auto group's preview would
 * put each group. Drag across it to select a range; click to clear. While
 * splitting (onSplitPick given), a click picks the value to split at instead. */
export function Histogram({
  label,
  unit,
  values,
  covered,
  intervals,
  marks,
  domain,
  selection,
  onSelect,
  splitValue = null,
  onSplitPick,
}: {
  label: string;
  unit: string;
  values: number[];
  /** Per value, whether it's within a Mode; null when there's nothing to compare with. */
  covered: boolean[] | null;
  intervals: Interval[];
  marks: number[];
  domain: [number, number];
  selection: [number, number] | null;
  /** Leave out where there's no filter to set. */
  onSelect?: (range: [number, number] | null) => void;
  /** Where a split is about to be made, drawn as a line. */
  splitValue?: number | null;
  /** Given while splitting: a click picks the value instead of selecting. */
  onSplitPick?: (value: number) => void;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [drag, setDragState] = useState<{ from: number; to: number } | null>(
    null,
  );
  // The live drag, for the pointer handlers — state can lag a fast drag by a render.
  const dragRef = useRef<{ from: number; to: number } | null>(null);
  const setDrag = (d: { from: number; to: number } | null) => {
    dragRef.current = d;
    setDragState(d);
  };
  const [hoverBin, setHoverBin] = useState<number | null>(null);
  const [hoverPx, setHoverPx] = useState<number | null>(null);
  const {
    inside,
    outside,
    width: binWidth,
  } = useMemo(
    () => binValues(values, covered, domain),
    [values, covered, domain],
  );

  const plotW = Math.max(10, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom;
  const [lo, hi] = domain;
  const span = hi - lo || 1;
  const x = (v: number) => M.left + ((v - lo) / span) * plotW;
  const toValue = (px: number) =>
    lo +
    ((Math.min(Math.max(px, M.left), M.left + plotW) - M.left) / plotW) * span;
  const maxCount = Math.max(1, ...inside.map((c, i) => c + outside[i]));
  const y = (count: number) => (count / maxCount) * plotH;
  const barW = plotW / BINS;
  const gap = barW > 4 ? 1 : 0;
  const baseline = M.top + plotH;

  const marksPath = useMemo(() => {
    let d = "";
    for (const m of marks)
      if (m >= lo && m <= hi) d += `M${x(m).toFixed(1)} ${M.top - 9}v7`;
    return d;
    // x depends only on lo/hi/width.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, lo, hi, width]);

  function localX(e: PointerEvent<SVGSVGElement>) {
    return e.clientX - e.currentTarget.getBoundingClientRect().left;
  }
  function onPointerDown(e: PointerEvent<SVGSVGElement>) {
    if (onSplitPick) {
      onSplitPick(toValue(localX(e)));
      return;
    }
    if (!onSelect) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const px = localX(e);
    setDrag({ from: px, to: px });
  }
  function onPointerMove(e: PointerEvent<SVGSVGElement>) {
    const px = localX(e);
    if (dragRef.current) setDrag({ ...dragRef.current, to: px });
    setHoverPx(px >= M.left && px <= M.left + plotW ? px : null);
    const bin = Math.floor((px - M.left) / barW);
    setHoverBin(bin >= 0 && bin < BINS ? bin : null);
  }
  function onPointerUp(e: PointerEvent<SVGSVGElement>) {
    const current = dragRef.current;
    if (!current || !onSelect) return;
    const drag = { ...current, to: localX(e) };
    if (Math.abs(drag.to - drag.from) < 4) onSelect(null);
    else {
      const a = toValue(Math.min(drag.from, drag.to));
      const b = toValue(Math.max(drag.from, drag.to));
      onSelect([a, b]);
    }
    setDrag(null);
  }

  // A chart zoomed to its own selection doesn't shade it — that would be the whole chart.
  const zoomedToSelection =
    selection != null && selection[0] <= lo && selection[1] >= hi;
  const band = drag
    ? [Math.min(drag.from, drag.to), Math.max(drag.from, drag.to)]
    : selection && !zoomedToSelection
      ? [x(Math.max(selection[0], lo)), x(Math.min(selection[1], hi))]
      : null;
  const total = values.length;
  const outsideTotal = covered ? outside.reduce((a, b) => a + b, 0) : 0;
  const hovered =
    hoverBin != null && !drag
      ? {
          lo: lo + hoverBin * binWidth,
          hi: lo + (hoverBin + 1) * binWidth,
          in: inside[hoverBin],
          out: outside[hoverBin],
        }
      : null;

  return (
    <div className="viz-card">
      <div className="viz-card-header">
        <strong>
          {label} <span className="hint-text">({unit})</span>
        </strong>
        <span className="hint-text">
          {total.toLocaleString()} value{total === 1 ? "" : "s"}
          {covered && total > 0 && (
            <>
              {" · "}
              <span className={outsideTotal > 0 ? "viz-out-text" : undefined}>
                {Math.round((outsideTotal / total) * 100)}% outside every Mode
              </span>
            </>
          )}
        </span>
      </div>
      <div ref={ref} className="viz-plot">
        {total === 0 ? (
          <p className="hint-text viz-empty">None in view.</p>
        ) : (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`${label} distribution`}
            className={onSplitPick ? "viz-splittable" : onSelect ? "viz-brushable" : undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => {
              setHoverBin(null);
              setHoverPx(null);
            }}
          >
            <line
              className="viz-grid"
              x1={M.left}
              x2={M.left + plotW}
              y1={M.top}
              y2={M.top}
            />
            <text
              className="viz-axis-label"
              x={M.left - 6}
              y={M.top + 4}
              textAnchor="end"
            >
              {maxCount.toLocaleString()}
            </text>
            {marksPath && <path className="viz-marks" d={marksPath} />}
            {inside.map((cIn, i) => {
              const cOut = outside[i];
              if (cIn + cOut === 0) return null;
              const bx = M.left + i * barW + gap / 2;
              const w = Math.max(1, barW - gap);
              const hIn = y(cIn);
              const hOut = y(cOut);
              return (
                <g
                  key={i}
                  className={hoverBin === i ? "viz-bar hovered" : "viz-bar"}
                >
                  {cIn > 0 && (
                    <rect
                      className={covered ? "viz-in" : "viz-single"}
                      x={bx}
                      y={baseline - hIn}
                      width={w}
                      height={hIn}
                    />
                  )}
                  {cOut > 0 && (
                    <rect
                      className="viz-out"
                      x={bx}
                      y={baseline - hIn - hOut}
                      width={w}
                      height={hOut}
                    />
                  )}
                </g>
              );
            })}
            <line
              className="viz-baseline"
              x1={M.left}
              x2={M.left + plotW}
              y1={baseline}
              y2={baseline}
            />
            {intervals.map(([a, b], i) => {
              if (b < lo || a > hi) return null;
              const x1 = x(Math.max(a, lo));
              const x2 = x(Math.min(b, hi));
              return (
                <rect
                  key={i}
                  className="viz-coverage"
                  x={x1}
                  y={baseline + 3}
                  width={Math.max(1.5, x2 - x1)}
                  height={5}
                />
              );
            })}
            {niceTicks(lo, hi).map((t) => (
              <text
                key={t}
                className="viz-axis-label"
                x={x(t)}
                y={HEIGHT - 8}
                textAnchor="middle"
              >
                {fmt(t)}
              </text>
            ))}
            {onSplitPick && hoverPx != null && (
              <line className="viz-split-hover" x1={hoverPx} x2={hoverPx} y1={M.top} y2={baseline} />
            )}
            {splitValue != null && splitValue >= lo && splitValue <= hi && (
              <g>
                <line className="viz-split" x1={x(splitValue)} x2={x(splitValue)} y1={M.top - 4} y2={baseline} />
                <text
                  className="viz-axis-label viz-split-label"
                  x={x(splitValue) + (x(splitValue) > M.left + plotW - 60 ? -4 : 4)}
                  y={M.top + 8}
                  textAnchor={x(splitValue) > M.left + plotW - 60 ? "end" : "start"}
                >
                  split at {fmt(splitValue)}
                </text>
              </g>
            )}
            {band && !onSplitPick && (
              <rect
                className="viz-selection"
                x={band[0]}
                y={M.top}
                width={Math.max(1, band[1] - band[0])}
                height={plotH}
              />
            )}
          </svg>
        )}
        {hovered && (
          <div
            className="viz-tooltip"
            style={{
              left: Math.min(
                Math.max(x(hovered.lo), 8),
                Math.max(8, width - 190),
              ),
            }}
          >
            <div>
              {fmt(hovered.lo)}–{fmt(hovered.hi)} {unit}
            </div>
            {onSplitPick && hoverPx != null && (
              <div>
                <strong>Click to split at {fmt(toValue(hoverPx))}</strong>
              </div>
            )}
            {covered ? (
              <>
                <div>
                  <span className="viz-swatch viz-in" />{" "}
                  {hovered.in.toLocaleString()} within a Mode
                </div>
                <div>
                  <span className="viz-swatch viz-out" />{" "}
                  {hovered.out.toLocaleString()} outside every Mode
                </div>
              </>
            ) : (
              <div>{(hovered.in + hovered.out).toLocaleString()} values</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
