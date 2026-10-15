import { useState } from "react";
import { Link } from "react-router-dom";
import { niceTicks, useWidth } from "../intercepts/charts/Histogram";
import type { Dwell } from "../../api/dwells";

const M = { top: 34, right: 18, bottom: 12, left: 58 };
const ROW = 26;
const MIN_BAND = 6;
const LANE = 9;
const LANE_GAP = 3;
// Overlay colours: series-2 onwards (series-1 is the dwells').
const OVERLAY_SLOTS = 7;

type Span = [number, number];

/** A number as the dwell pages write it: no thousands separators, trimmed. */
export function num(v: number): string {
  return String(Number(v.toPrecision(10)));
}

/** Something drawn behind the dwells across the frequencies it occupies —
 * e.g. one of the Platform's Emitters and its Modes' RF ranges. */
export interface DwellOverlay {
  id: string;
  label: string;
  spans: Span[];
  href?: string;
}

/** Ranges joined where they overlap or touch. */
function joined(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const [lo, hi] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && lo <= last[1]) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

/** How much of an overlay's frequencies the dwell bands sit on: a share of
 * its total width (0–1), or — when it's single frequencies only — whether
 * any band holds one of them. */
export function dwellCoverage(spans: Span[], bands: Span[]): number {
  const own = joined(spans);
  const cover = joined(bands);
  const total = own.reduce((sum, [lo, hi]) => sum + (hi - lo), 0);
  if (total === 0) return own.some(([f]) => cover.some(([lo, hi]) => f >= lo && f <= hi)) ? 1 : 0;
  let covered = 0;
  for (const [lo, hi] of own)
    for (const [blo, bhi] of cover) covered += Math.max(0, Math.min(hi, bhi) - Math.max(lo, blo));
  return covered / total;
}

/** One cycle of a Strategy as a waterfall: frequency (MHz) across, time (ms)
 * running down. Each dwell is a band of the given width around its
 * frequency, from when it starts to when the next one does; dashed lines
 * show the hop to the next. Hovering a band (or, from outside, a table row)
 * picks it out. With `overlay`, each one (an Emitter, say) is shaded behind
 * the dwells across its frequencies and drawn in a lane under the chart; the
 * legend shows or hides each, and how much of it the dwells sit on. */
export function DwellChart({
  dwells,
  bandwidthMhz,
  hover: hoverProp,
  onHover,
  height,
  title = "Dwells over one cycle",
  overlay,
  overlayTitle = "Emitters",
}: {
  dwells: Dwell[];
  bandwidthMhz: number;
  /** The dwell picked out (index into `dwells`), when the page shares it. */
  hover?: number | null;
  onHover?: (index: number | null) => void;
  /** Fixed plot height; by default it grows with the number of dwells. */
  height?: number;
  title?: string;
  overlay?: DwellOverlay[];
  overlayTitle?: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [ownHover, setOwnHover] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hoverOverlay, setHoverOverlay] = useState<string | null>(null);
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
  const bands: Span[] = steps.map(({ d }) => [d.freq_mhz - half, d.freq_mhz + half]);

  const layers = (overlay ?? [])
    .filter((o) => o.spans.length > 0)
    .map((o, k) => ({ ...o, slot: (k % OVERLAY_SLOTS) + 2, coverage: dwellCoverage(o.spans, bands) }));
  const shown = layers.filter((o) => !hidden.has(o.id));

  let lo = Math.min(...bands.map((b) => b[0]), ...shown.flatMap((o) => o.spans.map((s) => s[0])));
  let hi = Math.max(...bands.map((b) => b[1]), ...shown.flatMap((o) => o.spans.map((s) => s[1])));
  const pad = (hi - lo) * 0.04 || Math.max(half, 1);
  lo = Math.max(0, lo - pad);
  hi += pad;

  const plotH = height ?? Math.min(520, Math.max(220, steps.length * ROW));
  const lanesTop = M.top + plotH + (shown.length ? 8 : 0);
  const H = lanesTop + shown.length * (LANE + LANE_GAP) + M.bottom;
  const plotW = Math.max(160, width - M.left - M.right);
  const x = (mhz: number) => M.left + ((mhz - lo) / (hi - lo)) * plotW;
  const y = (ms: number) => M.top + (ms / total) * plotH;
  const picked = placed.find((p) => p.i === hover);
  const pickedLayer = layers.find((o) => o.id === hoverOverlay);
  const spanText = (spans: Span[]) => joined(spans).map(([a, b]) => (a === b ? num(a) : `${num(a)}–${num(b)}`)).join(", ");
  const pct = (c: number) => (c >= 0.995 ? "all" : c <= 0 ? "none" : `${Math.round(c * 100)}%`);

  return (
    <div className="viz-card dwell-chart">
      <div className="viz-card-header">
        <strong>{title}</strong>
        <span className="hint-text">
          {picked
            ? `Dwell ${picked.i + 1}: ${num(picked.d.freq_mhz)} MHz, ${num(picked.start)}–${num(picked.end)} ms · collect ${num(
                picked.d.collect_time_ms,
              )} ms`
            : pickedLayer
              ? `${pickedLayer.label}: ${spanText(pickedLayer.spans)} MHz · ${pct(pickedLayer.coverage)} dwelt on`
              : `${steps.length} dwell${steps.length === 1 ? "" : "s"} · ${num(total)} ms a cycle · bands ${num(bandwidthMhz)} MHz wide`}
        </span>
      </div>
      <div ref={ref} className="viz-plot" onPointerLeave={() => setHover(null)}>
        <svg width={width} height={H} role="img" aria-label="Each dwell's frequency (across) against time (down), over one cycle">
          {shown.map((o) =>
            joined(o.spans).map(([a, b], j) => (
              <rect
                key={`${o.id}-${j}`}
                className={`dwell-occupied series-${o.slot}${hoverOverlay === o.id ? " picked" : ""}${
                  hoverOverlay && hoverOverlay !== o.id ? " faded" : ""
                }`}
                x={x(a)}
                y={M.top}
                width={Math.max(2, x(b) - x(a))}
                height={plotH}
              />
            )),
          )}
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

          {shown.map((o, k) => (
            <g
              key={`lane-${o.id}`}
              className={hoverOverlay && hoverOverlay !== o.id ? "dwell-lane faded" : "dwell-lane"}
              onPointerEnter={() => setHoverOverlay(o.id)}
              onPointerLeave={() => setHoverOverlay(null)}
            >
              <title>{`${o.label}: ${spanText(o.spans)} MHz`}</title>
              <rect className="dwell-lane-track" x={M.left} y={lanesTop + k * (LANE + LANE_GAP)} width={plotW} height={LANE} />
              {joined(o.spans).map(([a, b], j) => (
                <rect
                  key={j}
                  className={`series-${o.slot}`}
                  x={x(a)}
                  y={lanesTop + k * (LANE + LANE_GAP)}
                  width={Math.max(3, x(b) - x(a))}
                  height={LANE}
                  rx={2}
                />
              ))}
            </g>
          ))}
        </svg>
      </div>
      {layers.length > 0 && (
        <div className="dwell-overlay-legend">
          <span className="dwell-overlay-title">{overlayTitle}</span>
          {layers.map((o) => {
            const off = hidden.has(o.id);
            return (
              <span
                key={o.id}
                className={off ? "dwell-overlay-item off" : "dwell-overlay-item"}
                onPointerEnter={() => setHoverOverlay(off ? null : o.id)}
                onPointerLeave={() => setHoverOverlay(null)}
              >
                <button
                  type="button"
                  className="dwell-overlay-toggle"
                  aria-pressed={!off}
                  aria-label={off ? `Show ${o.label}` : `Hide ${o.label}`}
                  title={off ? "Show it on the chart" : "Hide it from the chart"}
                  onClick={() => {
                    const next = new Set(hidden);
                    if (off) next.delete(o.id);
                    else next.add(o.id);
                    setHidden(next);
                  }}
                >
                  <span className={`viz-swatch series-${o.slot}`} />
                </button>
                {o.href ? <Link to={o.href}>{o.label}</Link> : o.label}
                <span
                  className={o.coverage <= 0 ? "dwell-coverage none" : o.coverage < 0.995 ? "dwell-coverage part" : "dwell-coverage"}
                  title={`${spanText(o.spans)} MHz — how much of it the dwell bands sit on`}
                >
                  {o.coverage <= 0 ? "not dwelt on" : `${pct(o.coverage)} dwelt on`}
                </span>
              </span>
            );
          })}
          {layers.length > 1 && (
            <button
              type="button"
              className="link-button"
              onClick={() => setHidden(hidden.size ? new Set() : new Set(layers.map((o) => o.id)))}
            >
              {hidden.size ? "Show all" : "Hide all"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
