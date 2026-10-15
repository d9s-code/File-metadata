import { useState } from "react";
import { niceTicks, useWidth } from "../intercepts/charts/Histogram";
import type { Dwell } from "../../api/dwells";

const M = { top: 34, right: 18, bottom: 12, left: 58 };
const ROW = 26;
const MIN_BAND = 6;

/** A number as the dwell pages write it: no thousands separators, trimmed. */
export function num(v: number): string {
  return String(Number(v.toPrecision(10)));
}

/** One cycle of a Strategy as a waterfall: frequency (MHz) across, time (ms)
 * running down. Each dwell is a band of the given width around its
 * frequency, from when it starts to when the next one does; dashed lines
 * show the hop to the next. Hovering a band (or, from outside, a table row)
 * picks it out. */
export function DwellChart({
  dwells,
  bandwidthMhz,
  hover: hoverProp,
  onHover,
  height,
  title = "Dwells over one cycle",
}: {
  dwells: Dwell[];
  bandwidthMhz: number;
  /** The dwell picked out (index into `dwells`), when the page shares it. */
  hover?: number | null;
  onHover?: (index: number | null) => void;
  /** Fixed plot height; by default it grows with the number of dwells. */
  height?: number;
  title?: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [ownHover, setOwnHover] = useState<number | null>(null);
  const hover = hoverProp !== undefined ? hoverProp : ownHover;
  const setHover = (i: number | null) => (onHover ? onHover(i) : setOwnHover(i));

  // Dwells still being typed (no frequency or time yet) are left out, but
  // keep their number so the chart and the table agree.
  const steps = dwells.map((d, i) => ({ d, i })).filter(({ d }) => d.freq_mhz > 0 && d.dwell_time_ms > 0);
  if (steps.length === 0) {
    return (
      <div className="viz-card dwell-chart">
        <div className="viz-card-header">
          <strong>{title}</strong>
        </div>
        <p className="hint-text dwell-chart-empty">Add a dwell with a frequency and a dwell time to see it here.</p>
      </div>
    );
  }

  let t = 0;
  const placed = steps.map(({ d, i }) => {
    const start = t;
    t += d.dwell_time_ms;
    return { d, i, start, end: t };
  });
  const total = t;
  const half = bandwidthMhz / 2;
  let lo = Math.min(...steps.map(({ d }) => d.freq_mhz - half));
  let hi = Math.max(...steps.map(({ d }) => d.freq_mhz + half));
  const pad = (hi - lo) * 0.04 || Math.max(half, 1);
  lo = Math.max(0, lo - pad);
  hi += pad;

  const plotH = height ?? Math.min(520, Math.max(220, steps.length * ROW));
  const H = plotH + M.top + M.bottom;
  const plotW = Math.max(160, width - M.left - M.right);
  const x = (mhz: number) => M.left + ((mhz - lo) / (hi - lo)) * plotW;
  const y = (ms: number) => M.top + (ms / total) * plotH;
  const shown = placed.find((p) => p.i === hover);

  return (
    <div className="viz-card dwell-chart">
      <div className="viz-card-header">
        <strong>{title}</strong>
        <span className="hint-text">
          {shown
            ? `Dwell ${shown.i + 1}: ${num(shown.d.freq_mhz)} MHz, ${num(shown.start)}–${num(shown.end)} ms · collect ${num(
                shown.d.collect_time_ms,
              )} ms`
            : `${steps.length} dwell${steps.length === 1 ? "" : "s"} · ${num(total)} ms a cycle · bands ${num(bandwidthMhz)} MHz wide`}
        </span>
      </div>
      <div ref={ref} className="viz-plot" onPointerLeave={() => setHover(null)}>
        <svg width={width} height={H} role="img" aria-label="Each dwell's frequency (across) against time (down), over one cycle">
          {niceTicks(lo, hi, Math.max(3, Math.floor(plotW / 90))).map((v) => (
            <g key={`x${v}`}>
              <line className="viz-grid" x1={x(v)} x2={x(v)} y1={M.top} y2={M.top + plotH} />
              <text className="viz-axis-label" x={x(v)} y={M.top - 8} textAnchor="middle">
                {num(v)}
              </text>
            </g>
          ))}
          {niceTicks(0, total, Math.max(3, Math.floor(plotH / 50))).map((v) => (
            <g key={`y${v}`}>
              <line className="viz-grid" x1={M.left} x2={M.left + plotW} y1={y(v)} y2={y(v)} />
              <text className="viz-axis-label" x={M.left - 6} y={y(v) + 4} textAnchor="end">
                {num(v)}
              </text>
            </g>
          ))}
          <text className="viz-axis-label" x={M.left + plotW / 2} y={11} textAnchor="middle">
            Frequency (MHz)
          </text>
          <text className="viz-axis-label" transform={`translate(12 ${M.top + plotH / 2}) rotate(-90)`} textAnchor="middle">
            Time (ms)
          </text>

          {placed.slice(1).map((p, k) => {
            const prev = placed[k];
            return (
              <line
                key={`hop${p.i}`}
                className="dwell-hop"
                x1={x(prev.d.freq_mhz)}
                y1={y(prev.end)}
                x2={x(p.d.freq_mhz)}
                y2={y(p.start)}
              />
            );
          })}
          {placed.map(({ d, i, start, end }) => {
            // Too narrow to see at this span: a band of MIN_BAND px centred on it.
            const natural = x(d.freq_mhz + half) - x(d.freq_mhz - half);
            const w = Math.max(MIN_BAND, natural);
            const left = natural < MIN_BAND ? x(d.freq_mhz) - MIN_BAND / 2 : x(d.freq_mhz - half);
            const top = y(start);
            const h = Math.max(2, y(end) - top);
            const inside = w >= 16 && h >= 13;
            return (
              <g
                key={i}
                className={`dwell-step${hover === i ? " hovered" : ""}${hover != null && hover !== i ? " dimmed" : ""}`}
                onPointerEnter={() => setHover(i)}
              >
                <title>{`Dwell ${i + 1}: ${num(d.freq_mhz)} MHz (± ${num(half)})\n${num(start)}–${num(end)} ms`}</title>
                {/* A wider invisible target, so a thin band is easy to point at. */}
                <rect className="dwell-hit" x={left - 4} y={top} width={w + 8} height={h} />
                <rect className="dwell-band series-1" x={left} y={top} width={w} height={h} rx={2} />
                {h >= 9 && (
                  <text
                    className={inside ? "dwell-step-label inside" : "dwell-step-label"}
                    x={inside ? left + w / 2 : left + w + 4}
                    y={top + Math.min(h, 22) / 2 + 4}
                    textAnchor={inside ? "middle" : "start"}
                  >
                    {i + 1}
                  </text>
                )}
              </g>
            );
          })}
          <line className="viz-axis" x1={M.left} x2={M.left + plotW} y1={M.top} y2={M.top} />
          <line className="viz-axis" x1={M.left} x2={M.left} y1={M.top} y2={M.top + plotH} />
        </svg>
      </div>
    </div>
  );
}
