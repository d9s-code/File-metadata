import { useState } from "react";
import { niceTicks, useWidth } from "../intercepts/charts/Histogram";
import type { MergedDwell } from "../../api/dwells";

const HEIGHT = 230;
const M = { top: 12, right: 16, bottom: 34, left: 62 };

/** A number as the dwell page writes it: no thousands separators, trimmed. */
export function num(v: number): string {
  return String(Number(v.toPrecision(10)));
}

/** The Merged Mode as a function of time: each dwell in turn, for its dwell
 * time, as a band of the given width around its frequency. One cycle; the
 * receiver then starts over. */
export function DwellChart({ dwells, bandwidthMhz }: { dwells: MergedDwell[]; bandwidthMhz: number }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const steps = dwells.filter((d) => d.freq_mhz > 0 && d.dwell_time_ms > 0);
  if (steps.length === 0) {
    return <p className="hint-text">Add a dwell with a frequency and a dwell time to see it over time.</p>;
  }

  let t = 0;
  const placed = steps.map((d, i) => {
    const start = t;
    t += d.dwell_time_ms;
    return { d, i, start, end: t };
  });
  const total = t;
  const half = bandwidthMhz / 2;
  let lo = Math.min(...steps.map((d) => d.freq_mhz - half));
  let hi = Math.max(...steps.map((d) => d.freq_mhz + half));
  const pad = (hi - lo) * 0.08 || Math.max(half, 1);
  lo -= pad;
  hi += pad;

  const plotW = Math.max(120, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom;
  const x = (ms: number) => M.left + (ms / total) * plotW;
  const y = (mhz: number) => M.top + (1 - (mhz - lo) / (hi - lo)) * plotH;

  return (
    <div className="viz-card dwell-chart">
      <div className="viz-card-header">
        <strong>Dwell over time</strong>
        <span className="hint-text">
          one cycle: {num(total)} ms · each band ± {num(half)} MHz around its frequency
        </span>
      </div>
      <div ref={ref} className="viz-plot" onPointerLeave={() => setHover(null)}>
        <svg width={width} height={HEIGHT} aria-label="The Merged Mode's frequency against time">
          {niceTicks(lo, hi, 5).map((v) => (
            <g key={`y${v}`}>
              <line className="viz-grid" x1={M.left} x2={M.left + plotW} y1={y(v)} y2={y(v)} />
              <text className="viz-axis-label" x={M.left - 6} y={y(v) + 4} textAnchor="end">
                {num(v)}
              </text>
            </g>
          ))}
          {niceTicks(0, total, 6).map((v) => (
            <g key={`x${v}`}>
              <line className="viz-grid" x1={x(v)} x2={x(v)} y1={M.top} y2={M.top + plotH} />
              <text className="viz-axis-label" x={x(v)} y={M.top + plotH + 16} textAnchor="middle">
                {num(v)}
              </text>
            </g>
          ))}
          <text className="viz-axis-label" x={M.left + plotW / 2} y={HEIGHT - 2} textAnchor="middle">
            time (ms)
          </text>
          <text
            className="viz-axis-label"
            transform={`translate(12 ${M.top + plotH / 2}) rotate(-90)`}
            textAnchor="middle"
          >
            MHz
          </text>
          {placed.map(({ d, i, start, end }) => (
            <g
              key={i}
              className={`dwell-step${hover === i ? " hovered" : ""}${hover != null && hover !== i ? " dimmed" : ""}`}
              onPointerEnter={() => setHover(i)}
            >
              <title>
                {`Dwell ${i + 1}: ${num(d.freq_mhz)} MHz ± ${num(half)}\n${num(start)}–${num(end)} ms (dwell ${num(
                  d.dwell_time_ms,
                )} ms, collect ${num(d.collect_time_ms)} ms)`}
              </title>
              <rect
                className="dwell-band series-1"
                x={x(start)}
                y={y(d.freq_mhz + half)}
                width={Math.max(2, x(end) - x(start))}
                height={Math.max(2, y(d.freq_mhz - half) - y(d.freq_mhz + half))}
              />
              <line className="dwell-centre" x1={x(start)} x2={x(end)} y1={y(d.freq_mhz)} y2={y(d.freq_mhz)} />
              {x(end) - x(start) > 18 && (
                <text className="dwell-step-label" x={(x(start) + x(end)) / 2} y={y(d.freq_mhz + half) - 4} textAnchor="middle">
                  {i + 1}
                </text>
              )}
            </g>
          ))}
          <line className="viz-axis" x1={M.left} x2={M.left + plotW} y1={M.top + plotH} y2={M.top + plotH} />
          <line className="viz-axis" x1={M.left} x2={M.left} y1={M.top} y2={M.top + plotH} />
        </svg>
      </div>
    </div>
  );
}
